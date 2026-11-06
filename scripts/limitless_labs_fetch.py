"""Haalt toernooiresultaten en decklists op van Limitless Labs (officiële Pokémon TCG-events).

Gebruik:
    python -I limitless_labs_fetch.py
    python -I limitless_labs_fetch.py --season 2027 --out labs_data
    python -I limitless_labs_fetch.py --events 0073 --max-decklists 20     # korte test
    python -I limitless_labs_fetch.py --offline --app-dir ../site     # alleen verwerken, niets ophalen

Labs heeft geen officiële API; de site laadt zijn data als JSON van mew.limitlesstcg.com.
Het script vraagt rustig op (standaard 1 request per seconde), meldt zich met de User-Agent
MatchupMeta/1.0 (+adres van de site) en bewaart elke response in <out>/raw/. Een volgende run haalt
daardoor alleen nieuwe events en ontbrekende decklists op.

Zonder --season volgt het seizoen uit de datum (matchup_meta.py): het lopende seizoen, of het vorige
zolang het lopende nog geen afgeronde Regional heeft, zodat de tier list nooit leeg is of op een paar
losse events rust. De uitvoer zegt welk seizoen gekozen is en waarom.

Weging per event: elk event telt even zwaar, behalve dat het gewicht per --half-life dagen ouder dan
het nieuwste event halveert (ADR 0003). Het continent weegt de browser zelf mee in het aandeel.

Met --top 500 tellen per event alleen de 500 best geëindigde spelers mee (resultaten, decklists en
hun games, ook tegen spelers daaronder). Decklists van de rest worden dan ook niet opgehaald.

Schrijft naar <out>:
    events.csv      event_id, name, type, city, country, start_date, players, rounds,
                    continent, recency
    standings.csv   event_id, player, placement, points, wins, losses, ties, opw, day2, topcut,
                    dropped, drop_round, deck_id, has_decklist
    matches.csv     event_id, round, table, player1, player2, winner, deck1, deck2
                    (winner: 1 of 2 = die speler, 0 = gelijk, -1 = beide verloren; bye: player2 leeg)
    decklists.csv   event_id, player, section, card_key, name, set, number, count
    cards.csv       card_key, section, name, set, number, decks, copies
    archetypes.csv  deck_id, deck_name, icons, players, weighted_players, day2, topcut

Met --app-dir komt er ook labs.json voor de tier list-app: per deck de resultaten (aandeel,
Day 2-conversie, top cut, eindpositie), kaartgebruik, een consensuslijst en een paar echte lijsten.
Per Regional staan er het continent, de datum, het recency-gewicht en het aantal getelde spelers in, en
per deck het aantal getelde spelers per Regional ("counts", in de volgorde van "events"). Daarmee rekent
de browser het aandeel per continent uit; "share" is het aandeel Worldwide (alleen recency weegt).

Spelers staan erin als het vaste Limitless-id (gelijk over events heen), zonder namen.
"""
import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I zet de map van het script niet op het pad
from matchup_meta import USER_AGENT, season_of, season_start, today

SITE = "https://labs.limitlesstcg.com"
API = "https://mew.limitlesstcg.com/labs/data/tcg"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
# De vijf Play! Pokémon-zones (Continent in GLOSSARY.md) met hun vaste id in labs.json, en per zone de
# landcodes zoals Limitless ze geeft. Een land dat hier niet staat (bijv. Japan of Korea) krijgt geen continent.
CONTINENTS = {
    "na": ("North America", {"US", "CA", "PR"}),
    "latam": ("Latin America", {
        "MX", "GT", "BZ", "SV", "HN", "NI", "CR", "PA",                                  # Midden-Amerika
        "AR", "BO", "BR", "CL", "CO", "EC", "GY", "PY", "PE", "SR", "UY", "VE",          # Zuid-Amerika
        "AW", "BB", "BS", "CU", "CW", "DO", "HT", "JM", "TT",                            # Caraïben
    }),
    "eu": ("Europe", {
        "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB",
        "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO",
        "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "TR", "UA", "UK",
    }),
    "oce": ("Oceania", {"AU", "NZ", "FJ", "NC", "PG"}),
    "mesa": ("Middle East & South Africa", {"ZA", "AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "EG", "IL"}),
}
CONTINENT_OF = {country: cid for cid, (_, countries) in CONTINENTS.items() for country in countries}
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}
EVENT_NAMES = {"regional": "Regional Championship", "international": "International Championship",
               "worlds": "World Championship", "special": "Special Event"}
SECTIONS = ("pokemon", "trainer", "energy")
BASIC_ENERGY = {f"{t} Energy" for t in
                ("Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal")}
PRIOR_PLAYERS = 20   # weinig spelers: trekken naar het gemiddelde alsof er 20 gemiddelde spelers bij komen
MIN_USAGE = 0.03     # kaarten in minder lijsten laten we weg uit labs.json
MAX_LISTS = 5        # aantal echte lijsten per deck in labs.json


class LabsError(Exception):
    pass


def top_of(standings, top):
    """De spelers die meetellen: met top > 0 alleen wie op plek 1 t/m top eindigde."""
    return [r for r in standings if r["placement"] and r["placement"] <= top] if top else standings


def without_names(rows):
    """Spelersnamen zijn niet nodig voor de analyse en worden ook in de ruwe bestanden niet bewaard."""
    return [{k: v for k, v in r.items() if k not in ("name", "p1_name", "p2_name")} for r in rows]


class Client:
    """HTTP met een vaste pauze tussen requests en herhaalpogingen bij tijdelijke fouten."""

    def __init__(self, delay):
        self.delay = delay
        self.last = 0.0

    def get(self, url):
        for attempt in range(4):
            wait = self.last + self.delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise
                print(f"  HTTP {e.code}, opnieuw proberen...", flush=True)
            except urllib.error.URLError as e:
                if attempt == 3:
                    raise
                print(f"  verbindingsfout ({e.reason}), opnieuw proberen...", flush=True)
            time.sleep(10 * 3 ** attempt)  # 10, 30, 90 s

    def data(self, path, **params):
        body = json.loads(self.get(f"{API}/{path}?{urllib.parse.urlencode(params)}"))
        if not body.get("ok"):
            raise LabsError(f"{path} {params}: {body.get('message')}")
        return body["message"]


class Cache:
    """Ruwe responses per event in <out>/raw: losse JSON-bestanden en JSONL voor rondes en decklists."""

    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)

    def path(self, event_id, kind):
        return os.path.join(self.folder, f"{event_id}_{kind}")

    def load(self, event_id, kind):
        try:
            with open(self.path(event_id, kind + ".json"), encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None

    def save(self, event_id, kind, data):
        with open(self.path(event_id, kind + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def lines(self, event_id, kind):
        rows = []
        try:
            with open(self.path(event_id, kind + ".jsonl"), encoding="utf-8") as f:
                for line in f:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:  # half geschreven regel na een onderbreking
                        pass
        except FileNotFoundError:
            pass
        return rows

    def append(self, event_id, kind, row):
        line = json.dumps(row, ensure_ascii=False) + "\n"
        for attempt in range(5):
            try:
                with open(self.path(event_id, kind + ".jsonl"), "a", encoding="utf-8") as f:
                    f.write(line)
                return
            except PermissionError:  # OneDrive of een virusscanner houdt het bestand even vast
                if attempt == 4:
                    raise
                time.sleep(2)

    def compact(self, event_id, kind, key):
        """Herschrijft een JSONL-bestand zonder dubbele en beschadigde regels (de laatste per sleutel telt)."""
        rows = {r[key]: r for r in self.lines(event_id, kind)}
        path = self.path(event_id, kind + ".jsonl")
        if not os.path.exists(path):
            return
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            for r in rows.values():
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        for attempt in range(5):
            try:
                os.replace(path + ".tmp", path)
                return
            except PermissionError:  # OneDrive of een virusscanner houdt het bestand even vast
                if attempt == 4:
                    raise
                time.sleep(2)

    def reset(self, event_id, kind):
        for ext in (".json", ".jsonl"):
            try:
                os.remove(self.path(event_id, kind + ext))
            except FileNotFoundError:
                pass


class RunLock:
    """Voorkomt dat twee runs tegelijk dezelfde bestanden aanvullen, ook als een run na slaapstand bevroren is."""

    def __init__(self, folder):
        self.path = os.path.join(folder, ".lock")
        self.f = None

    def __enter__(self):
        self.f = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.f.close()
            raise SystemExit("Er loopt al een andere run op deze map (misschien een run die na de slaapstand "
                             "nog bevroren is). Wacht tot die klaar is, of sluit dat venster eerst af.")
        return self

    def __exit__(self, *exc):
        self.f.close()


def event_meta(client, cache, event_id, division):
    meta = cache.load(event_id, "tournament")
    if meta is None:
        meta = client.data("tournament", id=event_id, division=division)
        if meta.get("completed"):  # lopende events niet vastleggen
            cache.save(event_id, "tournament", meta)
    return meta


def discover_events(client, cache, season, division):
    """Alle afgeronde events van een seizoen, van nieuw naar oud via de lijst op de Labs-homepage."""
    ids = sorted(set(re.findall(r'href="/(\d{4})/standings"', client.get(SITE + "/"))), reverse=True)
    found = []
    for event_id in ids:
        meta = event_meta(client, cache, event_id, division)
        if meta["season"] < season:
            break
        if meta["season"] == season and meta.get("completed"):
            found.append(event_id)
    return sorted(found)


def fetch_event(client, cache, event_id, division, refresh, max_decklists, top):
    meta = event_meta(client, cache, event_id, division)
    name = f"{EVENT_NAMES.get(meta['type'], meta['type'])} {meta['city']}"
    print(f"\n{name} ({event_id}): {meta['players']} spelers, {meta['round']} rondes", flush=True)

    if refresh:
        cache.reset(event_id, "standings")
        cache.reset(event_id, "pairings")
    standings = cache.load(event_id, "standings")
    if standings is None:
        standings = without_names(client.data("standings", tournamentId=event_id, division=division))
        cache.save(event_id, "standings", standings)

    have_rounds = {r["round"] for r in cache.lines(event_id, "pairings")}
    for rnd in range(1, meta["round"] + 1):
        if rnd not in have_rounds:
            cache.append(event_id, "pairings", {
                "round": rnd,
                "pairings": without_names(
                    client.data("pairings", tournamentId=event_id, division=division, round=rnd)),
            })
    print(f"  standings en {meta['round']} rondes pairings binnen", flush=True)

    have_lists = {r["tp_id"] for r in cache.lines(event_id, "decklists")}
    todo = [r["tp_id"] for r in top_of(standings, top) if r.get("decklist") and r["tp_id"] not in have_lists]
    if max_decklists:
        todo = todo[:max_decklists]
    print(f"  decklists: {len(have_lists)} bewaard, {len(todo)} ophalen"
          + (f" (±{len(todo) * client.delay / 60:.0f} min)" if todo else ""), flush=True)
    for n, tp_id in enumerate(todo, 1):
        try:
            decklist = client.data("decklist", tournamentId=event_id, playerId=f"{tp_id:04d}")
        except (LabsError, urllib.error.HTTPError) as e:  # lijst niet beschikbaar: niet blijven proberen
            print(f"  geen decklist voor speler {tp_id}: {e}", flush=True)
            decklist = None
        cache.append(event_id, "decklists", {"tp_id": tp_id, "decklist": decklist})
        if n % 100 == 0 or n == len(todo):
            print(f"  {n}/{len(todo)} decklists, nog ±{(len(todo) - n) * client.delay / 60:.0f} min", flush=True)
    return meta, name


def start_date(text):
    m = re.match(r"([A-Za-z]+) (\d+)\D.*?(\d{4})", text or "")
    return f"{m.group(3)}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}" if m and m.group(1) in MONTHS else ""


def card_key(section, card):
    """Trainers en Energy zijn per naam gelijk; Pokémon met dezelfde naam kunnen verschillen."""
    name = card["name"].replace("’", "'").strip()
    return f"{name} ({card['set']} {card['number']})" if section == "pokemon" else name


def cached_events(cache, season, top):
    """Events die volledig in <out>/raw staan (voor --offline): standings, alle rondes en alle decklists."""
    found = []
    for f in sorted(os.listdir(cache.folder)):
        m = re.match(r"(\d{4})_tournament\.json$", f)
        if not m:
            continue
        event_id = m.group(1)
        meta = cache.load(event_id, "tournament")
        standings = cache.load(event_id, "standings")
        if meta["season"] != season or standings is None:
            continue
        rounds = {r["round"] for r in cache.lines(event_id, "pairings")}
        lists = {r["tp_id"] for r in cache.lines(event_id, "decklists")}
        wanted = {r["tp_id"] for r in top_of(standings, top) if r.get("decklist")}
        if len(rounds) < meta["round"] or not wanted <= lists:
            print(f"  {event_id} overgeslagen: nog niet compleet ({len(wanted & lists)}/{len(wanted)} decklists)")
            continue
        found.append((event_id, meta, f"{EVENT_NAMES.get(meta['type'], meta['type'])} {meta['city']}"))
    return found


def pick_season(season, find, is_regional):
    """Met een vast seizoen dat seizoen. Anders het lopende, of het vorige zolang het lopende nog geen
    afgeronde Regional heeft: dan is de tier list nooit leeg of gebaseerd op een paar losse events.

    find(seizoen) geeft de afgeronde events van dat seizoen, is_regional(event) of het een Regional is.
    """
    if season:
        found = find(season)
    else:
        season = season_of(today())
        found = find(season)
        if not any(is_regional(e) for e in found):
            print(f"Seizoen {season} heeft nog geen afgeronde Regional; teruggevallen op seizoen {season - 1}.",
                  flush=True)
            season -= 1
            found = find(season)
    print(f"Seizoen {season} (vanaf {season_start(season)})", flush=True)
    return season, found


def event_weights(events, half_life):
    """Per half_life dagen ouder dan het nieuwste event halveert het gewicht; verder telt elk event even zwaar."""
    dates = {eid: start_date(meta["date"]) for eid, meta, _ in events}
    newest = max((dt.date.fromisoformat(d) for d in dates.values() if d), default=None)
    weights = {}
    for eid, meta, _ in events:
        age = (newest - dt.date.fromisoformat(dates[eid])).days if newest and dates[eid] else 0
        recency = 0.5 ** (age / half_life) if half_life > 0 else 1.0
        weights[eid] = {"recency": round(recency, 4)}
    return weights


def build_tables(cache, events, weights, top):
    tables = defaultdict(list)
    cards = {}
    card_use = defaultdict(lambda: [0, 0])
    archetypes = {}
    checks = []

    for event_id, meta, name in events:
        weight = weights[event_id]["recency"]
        tables["events"].append({
            "event_id": event_id, "name": name, "type": meta["type"], "city": meta["city"],
            "country": meta["country"], "continent": CONTINENT_OF.get(meta["country"], ""), "start_date": start_date(meta["date"]), "players": meta["players"],
            "rounds": meta["round"], **weights[event_id],
        })

        everyone = cache.load(event_id, "standings")
        global_id = {r["tp_id"]: r["player_id"] for r in everyone}
        standings = top_of(everyone, top)
        counted = {r["tp_id"] for r in standings}
        for r in standings:
            tables["standings"].append({
                "event_id": event_id, "player": r["player_id"], "placement": r["placement"],
                "points": r["points"], "wins": r["wins"], "losses": r["losses"], "ties": r["ties"],
                "opw": r["opw"], "day2": r["day2"], "topcut": r["topcut"], "dropped": r["dropped"],
                "drop_round": r["drop_round"] or "", "deck_id": r["deck_id"] or "", "has_decklist": r["decklist"],
            })
            if r["deck_id"]:
                a = archetypes.setdefault(r["deck_id"], {
                    "deck_id": r["deck_id"], "deck_name": r["deck_name"], "icons": r["icons"] or "",
                    "players": 0, "weighted_players": 0.0, "day2": 0, "topcut": 0})
                a["players"] += 1
                a["weighted_players"] += weight
                a["day2"] += r["day2"]
                a["topcut"] += r["topcut"]

        record = defaultdict(Counter)
        unknown = 0
        rounds = {r["round"]: r for r in cache.lines(event_id, "pairings")}  # dubbele rondes één keer
        for rnd in (rounds[k] for k in sorted(rounds)):
            for p in rnd["pairings"]:
                if not p.get("completed"):
                    continue
                if p["player1"] not in global_id or (p["player2"] and p["player2"] not in global_id):
                    unknown += 1
                winner = {p["player1"]: 1, p["player2"]: 2, 0: 0}.get(p["winner"], -1) if p["player2"] \
                    else (1 if p["winner"] == p["player1"] else -1)
                for side, pid in ((1, p["player1"]), (2, p["player2"])):
                    if pid:
                        record[pid]["T" if winner == 0 else "W" if winner == side else "L"] += 1
                if p["player1"] not in counted and p["player2"] not in counted:
                    continue
                tables["matches"].append({
                    "event_id": event_id, "round": rnd["round"], "table": p["table"] or "",
                    "player1": p["p1_id"], "player2": p["p2_id"] or "", "winner": winner,
                    "deck1": p["p1_deck"] or "", "deck2": p["p2_deck"] or "",
                })

        lists = {r["tp_id"]: r["decklist"] for r in cache.lines(event_id, "decklists") if r["tp_id"] in counted}
        not_60 = 0
        for tp_id, decklist in lists.items():
            if not decklist:
                continue
            total = 0
            for section in ("pokemon", "trainer", "energy"):
                for c in decklist.get(section) or []:
                    key = card_key(section, c)
                    cards.setdefault(key, {"card_key": key, "section": section, "name": c["name"],
                                           "set": c["set"], "number": c["number"]})
                    card_use[key][0] += 1
                    card_use[key][1] += c["count"]
                    total += c["count"]
                    tables["decklists"].append({
                        "event_id": event_id, "player": global_id.get(tp_id, ""), "section": section,
                        "card_key": key, "name": c["name"], "set": c["set"], "number": c["number"],
                        "count": c["count"],
                    })
            not_60 += total != 60

        off = sum(1 for r in standings
                  if (record[r["tp_id"]]["W"], record[r["tp_id"]]["L"], record[r["tp_id"]]["T"])
                  != (r["wins"], r["losses"], r["ties"]))
        checks.append((name, len(standings), sum(1 for d in lists.values() if d), not_60,
                       sum(1 for m in tables["matches"] if m["event_id"] == event_id), unknown, off))

    tables["cards"] = [{**c, "decks": card_use[k][0], "copies": card_use[k][1]}
                       for k, c in sorted(cards.items(), key=lambda kv: -card_use[kv[0]][0])]
    tables["archetypes"] = sorted(archetypes.values(), key=lambda a: -a["weighted_players"])
    for a in tables["archetypes"]:
        a["weighted_players"] = round(a["weighted_players"], 2)
    return tables, checks


def consensus(usage, list_weight, cards):
    """60 kaarten die het gemiddelde deck het best benaderen.

    Start met elke kaart die in minstens de helft van de lijsten zit, in het meest gespeelde aantal.
    Vul daarna aan (of haal weg) op basis van het gemiddelde aantal over alle lijsten.
    """
    expected = {k: u["sum"] / list_weight for k, u in usage.items()}
    pick = {k: max(u["counts"], key=lambda c: (u["counts"][c], c))
            for k, u in usage.items() if u["w"] / list_weight >= 0.5}
    cap = lambda k: 60 if cards[k][0] in BASIC_ENERGY else 4
    total = sum(pick.values())
    while total < 60:
        k = max((k for k in usage if pick.get(k, 0) < cap(k)),
                key=lambda k: expected[k] - pick.get(k, 0), default=None)
        if k is None:
            break
        pick[k] = pick.get(k, 0) + 1
        total += 1
    while total > 60:
        k = max(pick, key=lambda k: pick[k] - expected[k])
        pick[k] -= 1
        total -= 1
        if not pick[k]:
            del pick[k]
    return pick


def run_ml(folder, min_lists):
    """Aanbevolen lijsten per deck via labs_ml.py (heeft numpy en pandas nodig); leeg als dat niet lukt."""
    try:
        import labs_ml
    except ImportError as e:
        print(f"\nAanbevolen lijsten overgeslagen ({e}). Installeer numpy en pandas om ze te berekenen.")
        return {}
    print(f"\nAanbevolen lijsten berekenen voor decks met {min_lists}+ lijsten (15 tot 20 minuten)...", flush=True)
    results = labs_ml.run(folder, min_lists=min_lists, verbose=False)
    print(f"Verslag geschreven naar {os.path.join(folder, 'ml_report.txt')}")
    return results


def write_labs_json(path, cache, events, weights, settings, ml=None, top=0):
    """Compact bestand voor de app: resultaten, kaartgebruik, consensuslijst en echte lijsten per deck."""
    cards, card_index = [], {}

    def card_id(section, c):
        key = card_key(section, c)
        if key not in card_index:
            card_index[key] = len(cards)
            cards.append([c["name"], c["set"], c["number"], SECTIONS.index(section)])
        return card_index[key]

    decks = {}
    total_w = total_day2 = 0.0
    for e, (event_id, meta, name) in enumerate(events):
        w = weights[event_id]["recency"]
        everyone = cache.load(event_id, "standings")
        standings = top_of(everyone, top)
        lists = {r["tp_id"]: r["decklist"] for r in cache.lines(event_id, "decklists")}
        n, field = len(standings), len(everyone)  # percentiel binnen wie meetelt; "of" = hele event
        for r in standings:
            total_w += w
            total_day2 += w * r["day2"]
            if not r["deck_id"]:
                continue
            d = decks.setdefault(r["deck_id"], {
                "id": r["deck_id"], "name": r["deck_name"], "icons": r["icons"] or "", "players": 0,
                "w": 0.0, "day2": 0.0, "pw": 0.0, "pct": 0.0, "topcut": 0, "lw": 0.0, "lists": [],
                "counts": [0] * len(events),
                "usage": defaultdict(lambda: {"w": 0.0, "sum": 0.0, "counts": Counter()}),
            })
            d["players"] += 1
            d["counts"][e] += 1
            d["w"] += w
            d["day2"] += w * r["day2"]
            d["topcut"] += r["topcut"]
            pct = None
            if r["placement"] and n > 1:  # eindpositie als percentiel: 1 = winnaar, 0 = laatste
                pct = 1 - (r["placement"] - 1) / (n - 1)
                d["pw"] += w
                d["pct"] += w * pct
            decklist = lists.get(r["tp_id"])
            if not decklist:
                continue
            entries = Counter()
            for section in SECTIONS:
                for c in decklist.get(section) or []:
                    entries[card_id(section, c)] += c["count"]
            d["lw"] += w
            for k, count in entries.items():
                u = d["usage"][k]
                u["w"] += w
                u["sum"] += w * count
                u["counts"][count] += w
            d["lists"].append({"e": e, "place": r["placement"], "of": field, "pct": pct or 0.0,
                               "rec": f"{r['wins']}-{r['losses']}-{r['ties']}", "day2": r["day2"],
                               "top": r["topcut"], "cards": entries})

    day2_rate = total_day2 / total_w
    order = lambda entries: sorted(entries.items(), key=lambda kv: (cards[kv[0]][3], -kv[1], cards[kv[0]][0]))
    archetypes = []
    for d in sorted(decks.values(), key=lambda d: -d["w"]):
        usage, lw = d["usage"], d["lw"]
        pick = consensus(usage, lw, cards) if lw else {}
        # Meest typische lijst: de Day 2-lijst (of anders welke dan ook) die het dichtst bij de consensus zit.
        pool = [x for x in d["lists"] if x["day2"]] or d["lists"]
        dist = lambda x: sum(abs(x["cards"].get(k, 0) - pick.get(k, 0)) for k in set(x["cards"]) | set(pick))
        typical = min(pool, key=dist) if pool else None
        best = sorted(d["lists"], key=lambda x: (-x["pct"], -weights[events[x["e"]][0]]["recency"]))[:MAX_LISTS]
        if typical and typical not in best:
            best = best[:MAX_LISTS - 1] + [typical]
        archetypes.append({
            "id": d["id"], "name": d["name"], "icons": d["icons"], "players": d["players"],
            "lists_n": len(d["lists"]), "counts": d["counts"],
            "share": round(d["w"] / total_w, 5),
            "day2": round(d["day2"] / d["w"], 4),
            "conv": round((d["day2"] + PRIOR_PLAYERS * day2_rate) / (d["w"] + PRIOR_PLAYERS) / day2_rate, 3),
            "pct": round((d["pct"] + PRIOR_PLAYERS * 0.5) / (d["pw"] + PRIOR_PLAYERS), 3),
            "topcut": d["topcut"],
            "usage": [[k, round(u["w"] / lw, 3), max(u["counts"], key=lambda c: (u["counts"][c], c)),
                       round(u["sum"] / u["w"], 2)]
                      for k, u in sorted(usage.items(), key=lambda kv: -kv[1]["w"]) if u["w"] / lw >= MIN_USAGE],
            "consensus": order(pick),
            "lists": [{"e": x["e"], "place": x["place"], "of": x["of"], "rec": x["rec"], "day2": x["day2"],
                       "top": x["top"], "typical": int(x is typical), "cards": order(x["cards"])} for x in best],
        })

    # Aanbevolen lijsten (labs_ml.py): kaarten als nummers, events als index, getallen afgerond.
    event_index = {eid: e for e, (eid, _, _) in enumerate(events)}
    for a in archetypes:
        r = (ml or {}).get(a["id"])
        if not r:
            continue
        a["ml"] = {
            "signal": r["signal"], "z": r["z"], "z_fwd": r.get("z_fwd"), "games": r["games"], "within": r["within"],
            "base": round(r["base"], 4), "opps": {c: round(v, 4) for c, v in r["opps"].items()}, "inter": r["inter"],
            "cards": [[card_index[c["key"]], round(c["b"], 5), round(c["se"], 5), round(c["mean"], 3),
                       [round(v, 5) for v in c["g"]], [round(v, 5) for v in c["gse"]]]
                      for c in r["cards"] if c["key"] in card_index],
            "cands": [{"e": event_index[x["event"]], "place": x["place"], "of": x["of"], "rec": x["rec"],
                       "top": x["top"], "n": x["n"], "d": round(x["d"], 4), "di": [round(v, 4) for v in x["di"]],
                       "se": round(x["se"], 4),
                       "cards": order(Counter({card_index[k]: v for k, v in x["counts"].items() if k in card_index}))}
                      for x in r["cands"] if x["event"] in event_index],
        }

    # Alleen kaarten die in labs.json gebruikt worden, met nieuwe nummers.
    used = sorted({k for a in archetypes for k in
                   [u[0] for u in a["usage"]] + [k for k, _ in a["consensus"]]
                   + [k for x in a["lists"] for k, _ in x["cards"]]
                   + [c[0] for c in a.get("ml", {}).get("cards", [])]
                   + [k for x in a.get("ml", {}).get("cands", []) for k, _ in x["cards"]]})
    remap = {k: i for i, k in enumerate(used)}
    for a in archetypes:
        a["usage"] = [[remap[u[0]]] + u[1:] for u in a["usage"]]
        a["consensus"] = [[remap[k], c] for k, c in a["consensus"]]
        for x in a["lists"]:
            x["cards"] = [[remap[k], c] for k, c in x["cards"]]
        if "ml" in a:
            a["ml"]["cards"] = [[remap[c[0]]] + c[1:] for c in a["ml"]["cards"]]
            for x in a["ml"]["cands"]:
                x["cards"] = [[remap[k], c] for k, c in x["cards"]]

    data = {
        "generated": dt.datetime.now().isoformat(timespec="minutes"),
        "source": "Limitless Labs",
        "season": settings["season"],
        "settings": settings,
        "day2_rate": round(day2_rate, 4),
        "events": [{"id": eid, "name": name, "country": meta["country"],
                    "continent": CONTINENT_OF.get(meta["country"]), "date": start_date(meta["date"]),
                    "players": len(top_of(cache.load(eid, "standings"), top)),
                    "field": len(cache.load(eid, "standings")), **weights[eid]} for eid, meta, name in events],
        "cards": [cards[k] for k in used],
        "archetypes": archetypes,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--season", type=int, default=0,
                   help="seizoen (bijv. 2027); standaard het lopende seizoen, of het vorige als dat nog geen Regional heeft")
    p.add_argument("--events", default="", help="vaste Labs-id's, komma-gescheiden (bijv. 0072,0077); "
                                                "standaard alle afgeronde events van --season")
    p.add_argument("--division", default="MA", help="MA = Masters, SR = Seniors, JR = Juniors")
    p.add_argument("--half-life", type=float, default=30,
                   help="na zoveel dagen telt een event half zo zwaar als het nieuwste (0 = uit)")
    p.add_argument("--top", type=int, default=0,
                   help="per event alleen de spelers op plek 1 t/m top meetellen (0 = iedereen)")
    p.add_argument("--delay", type=float, default=1.0, help="seconden tussen requests")
    p.add_argument("--max-decklists", type=int, default=0,
                   help="maximaal aantal nieuwe decklists per event (0 = alle); handig om te testen")
    p.add_argument("--refresh", action="store_true",
                   help="standings en pairings opnieuw ophalen (bewaarde decklists blijven staan)")
    p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "labs_data"),
                   help="map voor de CSV's; ruwe responses komen in <out>/raw")
    p.add_argument("--app-dir", default="", help="map van de tier list-app; schrijft daar labs.json")
    p.add_argument("--offline", action="store_true",
                   help="niets ophalen; alleen de bewaarde events verwerken die compleet zijn")
    p.add_argument("--no-ml", action="store_true", help="geen aanbevolen lijsten berekenen (sneller)")
    p.add_argument("--min-lists", type=int, default=300, help="aanbevolen lijsten alleen voor decks met zoveel lijsten")
    a = p.parse_args()

    client = Client(a.delay)
    cache = Cache(os.path.join(a.out, "raw"))
    chosen = [x.strip().zfill(4) for x in a.events.split(",") if x.strip()]
    if a.offline:
        a.season, found = pick_season(a.season, lambda s: cached_events(cache, s, a.top),
                                      lambda e: e[1]["type"] == "regional")
        events = [e for e in found if not chosen or e[0] in chosen]
        print(f"Bewaarde events: {', '.join(e[0] for e in events)}", flush=True)
    else:
        with RunLock(cache.folder):
            if chosen:
                a.season = a.season or season_of(today())
                ids = chosen
            else:
                a.season, ids = pick_season(
                    a.season, lambda s: discover_events(client, cache, s, a.division),
                    lambda event_id: event_meta(client, cache, event_id, a.division)["type"] == "regional")
            print(f"Events: {', '.join(ids)} (divisie {a.division})", flush=True)
            events = []
            for event_id in ids:
                meta, name = fetch_event(client, cache, event_id, a.division, a.refresh, a.max_decklists, a.top)
                events.append((event_id, meta, name))
                cache.compact(event_id, "pairings", "round")
                cache.compact(event_id, "decklists", "tp_id")
    if not events:
        raise SystemExit("Geen complete events gevonden.")

    weights = event_weights(events, a.half_life)
    tables, checks = build_tables(cache, events, weights, a.top)
    for kind in ("events", "standings", "matches", "decklists", "cards", "archetypes"):
        write_csv(os.path.join(a.out, f"{kind}.csv"), tables[kind])
    print(f"\nGeschreven naar {a.out}: {len(tables['standings'])} spelers, {len(tables['matches'])} matches, "
          f"{len(tables['decklists'])} decklistregels, {len(tables['cards'])} kaarten, "
          f"{len(tables['archetypes'])} archetypes")
    print("\nControle per event (spelers / decklists / lijsten != 60 kaarten / matches / "
          "onbekende spelers in pairings / W-L-T wijkt af van standings):")
    for row in checks:
        print("  {}: {} / {} / {} / {} / {} / {}".format(*row))

    if a.app_dir:
        os.makedirs(a.app_dir, exist_ok=True)
        ml = {} if a.no_ml else run_ml(a.out, a.min_lists)
        write_labs_json(os.path.join(a.app_dir, "labs.json"), cache, events, weights, {
            "season": a.season, "division": a.division, "half_life": a.half_life,
            "min_lists": a.min_lists, "top": a.top}, ml, a.top)
        print(f"labs.json voor de app geschreven naar {a.app_dir}")


if __name__ == "__main__":
    main()
