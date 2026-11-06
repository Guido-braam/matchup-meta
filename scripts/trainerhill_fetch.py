"""Haalt archetypes en matchups op van Trainerhill (Pokémon TCG) via de Dash-API.

Gebruik:
    python -I trainerhill_fetch.py
    python -I trainerhill_fetch.py --start 2026-08-01 --end 2026-10-16 --players 30 --out data
    python -I trainerhill_fetch.py --app-dir ../site --dry-run     # alleen seizoen en filters tonen

Zonder --start en --end telt het seizoen dat de site toont: dat uit labs.json in --app-dir (de
Limitless-run kiest het, dus draai die eerst), anders het lopende seizoen volgens de datum
(matchup_meta.py). Start is 1 augustus aan het begin van dat seizoen, einde vandaag maar niet na
31 juli, zodat een teruggevallen seizoen geen events van het nieuwe meeneemt. Requests gaan met de
User-Agent MatchupMeta/1.0 (+adres van de site).

Schrijft twee CSV's:
    archetypes.csv  archetype_id, archetype, deck_count, meta_share, sprite1, sprite2
    matchups.csv    deck_id, opponent_id, wins, losses, ties, games, win_rate

De server geeft een lege lijst terug als de response te groot wordt (>~140 archetypes).
Daarom worden de archetypes in blokken verdeeld en wordt elk paar blokken apart opgevraagd.
"""
import argparse
import base64
import csv
import datetime as dt
import itertools
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I zet de map van het script niet op het pad
from matchup_meta import USER_AGENT, season_end, season_of, season_start, today

URL = "https://www.trainerhill.com/_dash-update-component"
BLOCK_SIZE = 50  # twee blokken samen blijven ruim onder de grens van ~140


def call(body):
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["response"]


def fetch_archetypes(tour):
    resp = call({
        "output": "..meta-archetype-select.options...meta-archetype-store.data..",
        "outputs": [
            {"id": "meta-archetype-select", "property": "options"},
            {"id": "meta-archetype-store", "property": "data"},
        ],
        "inputs": [{"id": "meta-tour-store", "property": "data", "value": tour}],
        "changedPropIds": ["meta-tour-store.data"],
        "state": [],
    })
    sprites = {}
    for o in resp["meta-archetype-select"]["options"]:
        children = (o.get("label") or {}).get("props", {}).get("children") or []
        sprites[o["value"]] = [c["props"]["src"] for c in children
                               if isinstance(c, dict) and c.get("type") == "Img"]
    data = resp["meta-archetype-store"]["data"]
    total = sum(a["count"] for a in data)
    rows = []
    for a in data:
        imgs = sprites.get(a["id"], []) + ["", ""]
        rows.append({
            "archetype_id": a["id"],
            "archetype": a["name"],
            "deck_count": a["count"],
            "meta_share": round(a["count"] / total, 6),
            "sprite1": imgs[0],
            "sprite2": imgs[1],
        })
    return rows


def fetch_matchups_raw(tour, ids, placing, result_rate):
    resp = call({
        "output": "meta-matchup-data-store.data",
        "outputs": {"id": "meta-matchup-data-store", "property": "data"},
        "inputs": [
            {"id": "meta-tour-store", "property": "data", "value": tour},
            {"id": "meta-archetype-select", "property": "value", "value": ids},
            {"id": "meta-placing", "property": "value", "value": placing},
            {"id": "meta-result-rate", "property": "value", "value": result_rate},
        ],
        "changedPropIds": ["meta-archetype-select.value"],
        "state": [],
    })
    return resp["meta-matchup-data-store"]["data"]


def fetch_matchups(tour, ids, placing="10000", result_rate="ties_count_as_third_win"):
    blocks = [ids[i:i + BLOCK_SIZE] for i in range(0, len(ids), BLOCK_SIZE)]
    pairs = list(itertools.combinations(range(len(blocks)), 2)) or [(0, 0)]
    rows = {}
    for n, (i, j) in enumerate(pairs, 1):
        sel = blocks[i] + (blocks[j] if j != i else [])
        data = fetch_matchups_raw(tour, sel, placing, result_rate)
        if not data:
            raise RuntimeError(f"Lege response voor blok {i}+{j} ({len(sel)} archetypes)")
        for r in data:
            key = (r["deck1"], r["deck2"])
            prev = rows.get(key)
            if prev and (prev["wins"], prev["losses"], prev["ties"]) != (r["wins"], r["losses"], r["ties"]):
                raise RuntimeError(f"Tegenstrijdige data voor {key}: {prev} vs {r}")
            rows[key] = r
        print(f"  blok {n}/{len(pairs)}: {len(data)} rijen")
    return [{
        "deck_id": r["deck1"],
        "opponent_id": r["deck2"],
        "wins": r["wins"],
        "losses": r["losses"],
        "ties": r["ties"],
        "games": r["wins"] + r["losses"] + r["ties"],
        "win_rate": r["win_rate"],
    } for r in sorted(rows.values(), key=lambda r: (r["deck1"], r["deck2"]))]


def fetch_sprite(url, cache={}):
    """Sprite als data-URI, zodat de web-app geen externe afbeeldingen hoeft te laden."""
    if not url:
        return ""
    url = urllib.parse.urljoin("https://www.trainerhill.com/", url)  # sommige sprites zijn relatief
    if url not in cache:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                cache[url] = "data:image/png;base64," + base64.b64encode(r.read()).decode("ascii")
        except Exception as e:  # ontbrekende sprite mag de rest niet tegenhouden
            print(f"  sprite niet gevonden: {url} ({e})")
            cache[url] = ""
    return cache[url]


def write_app_json(path, tour, archetypes, matchups):
    """Compact databestand voor de tier list-app: matchups als [deck, tegenstander, W, L, T] met indexen."""
    index = {a["archetype_id"]: i for i, a in enumerate(archetypes)}
    data = {
        "generated": dt.datetime.now().isoformat(timespec="minutes"),
        "filters": tour,
        "archetypes": [{
            "id": a["archetype_id"],
            "name": a["archetype"],
            "count": a["deck_count"],
            "share": a["meta_share"],
            "sprites": [s for s in (fetch_sprite(a["sprite1"]), fetch_sprite(a["sprite2"])) if s],
        } for a in archetypes],
        "matchups": [[index[m["deck_id"]], index[m["opponent_id"]], m["wins"], m["losses"], m["ties"]]
                     for m in matchups if m["deck_id"] in index and m["opponent_id"] in index],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)


def shown_season(app_dir):
    """Het seizoen dat de site toont: dat uit labs.json in de app-map (de Limitless-run kiest het), anders het lopende."""
    if app_dir:
        try:
            with open(os.path.join(app_dir, "labs.json"), encoding="utf-8") as f:
                season = json.load(f).get("season")
            if season:
                return season, "labs.json"
        except (FileNotFoundError, ValueError):
            pass
    return season_of(today()), "datum"


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", default="", help="startdatum (yyyy-mm-dd), standaard 1 augustus aan het begin van het seizoen")
    p.add_argument("--end", default="", help="einddatum (yyyy-mm-dd), standaard vandaag maar niet na 31 juli (einde seizoen)")
    p.add_argument("--players", type=int, default=30, help="minimaal aantal spelers per toernooi")
    p.add_argument("--platform", default="all")
    p.add_argument("--divisions", default="JR,SR,MA")
    p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "trainerhill_data"), help="map voor de CSV's")
    p.add_argument("--app-dir", default="", help="map van de tier list-app; schrijft daar data.json (met sprites)")
    p.add_argument("--dry-run", action="store_true", help="alleen seizoen en filters tonen, niets ophalen")
    a = p.parse_args()

    season, source = shown_season(a.app_dir)
    tour = {
        "players": a.players,
        "start_date": a.start or season_start(season).isoformat(),
        "end_date": a.end or min(today(), season_end(season)).isoformat(),
        "platform": a.platform, "game": "PTCG", "division": a.divisions.split(","),
    }
    print(f"Seizoen {season} (uit {source})")
    print(f"Filters: {json.dumps(tour)}")
    if a.dry_run:
        print(f"User-Agent: {USER_AGENT}")
        return
    archetypes = fetch_archetypes(tour)
    print(f"{len(archetypes)} archetypes, {sum(x['deck_count'] for x in archetypes)} decks")
    matchups = fetch_matchups(tour, [x["archetype_id"] for x in archetypes])
    print(f"{len(matchups)} matchups")

    os.makedirs(a.out, exist_ok=True)
    write_csv(os.path.join(a.out, "archetypes.csv"), archetypes)
    write_csv(os.path.join(a.out, "matchups.csv"), matchups)
    print(f"Geschreven naar {a.out}")

    if a.app_dir:
        os.makedirs(a.app_dir, exist_ok=True)
        write_app_json(os.path.join(a.app_dir, "data.json"), tour, archetypes, matchups)
        print(f"data.json voor de app geschreven naar {a.app_dir}")


if __name__ == "__main__":
    main()
