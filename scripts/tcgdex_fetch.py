"""Haalt kaartdata en kaartplaatjes op van TCGdex (Engels) voor de series Scarlet & Violet en Mega Evolution.

Gebruik:
    python -I tcgdex_fetch.py                    # schrijft naar site/cards/
    python -I tcgdex_fetch.py --out /tmp/cards
    python -I tcgdex_fetch.py --check-labs site/labs.json   # alleen controleren, zonder netwerk

Met --check-labs haalt het script niets op: het print een GitHub-waarschuwing (::warning::) voor elke
kaart in dat labs.json die <out>/index.json niet kent, en eindigt altijd zonder fout. De data-refresh
draait dit na het bouwen van labs.json (ADR 0005).

TCGdex is gratis en heeft geen key nodig (ADR 0005). Het script vraagt met 4 tegelijk op, meldt zich met
de User-Agent MatchupMeta/1.0 (+adres van de site) en probeert het bij 429 en 5xx een paar keer opnieuw.
Elke andere HTTP-fout stopt het script met een foutcode, behalve een 404 op een plaatje: die kaart
krijgt geen plaatje (en de volgende run probeert het opnieuw).

Een run haalt alleen kaarten en plaatjes op die er nog niet zijn. De setlijsten (welke sets, welke
kaarten, setgegevens) en de legaliteit van elke kaart (twee lijst-calls) worden wel elke run ververst.
Een nieuwe serie (na Mega Evolution) moet hieronder in SERIES bij.

Schrijft naar <out>:
    <set id>/<localId>.webp   het lage-resolutieplaatje van de kaart (kaarten zonder plaatje hebben er geen)
    <set id>.json             de set van TCGdex, met in "cards" de volledige kaartdata; "pricing" en
                              "updated" zijn overal weggelaten (ook in variants_detailed), die veranderen dagelijks
    index.json                de Card index (GLOSSARY.md):
        sets   setcode (abbreviation.official, bijv. "MEG") -> [{id, releaseDate}], oudste eerst;
               een code kan bij meer sets horen ("30C" -> 30th en 30th-c)
        cards  TCGdex-id ("<set id>-<localId>") -> {name, category, stage, trainerType, energyType,
               aceSpec, fancy, image}; stage, trainerType en energyType alleen als TCGdex ze geeft, aceSpec
               alleen als true (rarity "ACE SPEC Rare"), fancy alleen als true (rarity in FANCY),
               image altijd (true als het plaatje er is)
        energyArt  naam van een basis-Energy -> TCGdex-id van zijn gewone plaatje (ENERGY_ART, Crown Zenith)
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I zet de map van het script niet op het pad
from matchup_meta import USER_AGENT

API = "https://api.tcgdex.net/v2/en"
SERIES = ("sv", "me")
DROP = {"pricing", "updated"}
# Full art, gold en andere luxe versies; een Trainer of Energy zonder plaatje leent liever een gewone versie.
FANCY = {"Ultra Rare", "Special illustration rare", "Hyper rare"}
# Basis-Energy heeft in sv en me alleen plaatjes van de secret rare versie. De nieuwste gewone versie met
# een Engels plaatje komt uit Crown Zenith; die plaatjes gebruikt de site voor basis-Energy zonder plaatje.
ENERGY_ART = {f"swsh12.5-{n}": name for n, name in zip(range(152, 160), (
    "Grass Energy", "Fire Energy", "Water Energy", "Lightning Energy",
    "Psychic Energy", "Fighting Energy", "Darkness Energy", "Metal Energy"))}
WORKERS = 4
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "cards")


def get(url):
    """De enige plek die het netwerk op gaat (de tests vervangen deze functie). Geeft de body als bytes."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            print(f"  HTTP {e.code} op {url}, opnieuw proberen...", flush=True)
        except urllib.error.URLError as e:
            if attempt == 3:
                raise
            print(f"  verbindingsfout ({e.reason}), opnieuw proberen...", flush=True)
        time.sleep(5 * 3 ** attempt)  # 5, 15, 45 s


def api(path):
    return json.loads(get(f"{API}/{path}"))


def strip(x):
    """Laat pricing en updated weg, op elk niveau."""
    if isinstance(x, dict):
        return {k: strip(v) for k, v in x.items() if k not in DROP}
    if isinstance(x, list):
        return [strip(v) for v in x]
    return x


def write(path, data):
    """Eerst naar een tijdelijk bestand, zodat een afgebroken run geen half bestand achterlaat."""
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)


def write_json(path, data):
    write(path, json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def load_cards(path):
    """De kaarten die er al zijn, per id."""
    try:
        with open(path, encoding="utf-8") as f:
            return {c["id"]: c for c in json.load(f)["cards"]}
    except FileNotFoundError:
        return {}


def index_entry(card, has_image):
    e = {"name": card["name"], "category": card.get("category")}
    for k in ("stage", "trainerType", "energyType"):
        if card.get(k):
            e[k] = card[k]
    if card.get("rarity") == "ACE SPEC Rare":
        e["aceSpec"] = True
    if card.get("rarity") in FANCY:
        e["fancy"] = True
    e["image"] = has_image
    return e


def fetch_set(set_id, out, legal, pool):
    """Haalt een set op (alleen ontbrekende kaarten en plaatjes) en schrijft <set id>.json. Geeft de set en de index-entries."""
    info = api(f"sets/{set_id}")
    known = load_cards(os.path.join(out, f"{set_id}.json"))
    os.makedirs(os.path.join(out, set_id), exist_ok=True)
    new = {"cards": 0, "images": 0}

    def one(brief):
        card = known.get(brief["id"])
        if card is None:
            card = strip(api(f"cards/{brief['id']}"))
            new["cards"] += 1
        card["legal"] = {name: brief["id"] in ids for name, ids in legal.items()}
        image = os.path.join(out, set_id, f"{card['localId']}.webp")
        if card.get("image") and not os.path.exists(image):
            try:
                write(image, get(card["image"] + "/low.webp"))
                new["images"] += 1
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise
                # Een paar kaarten noemen een plaatje dat TCGdex niet heeft: geen plaatje, volgende run opnieuw
                print(f"  geen plaatje op {card['image']}/low.webp (404)", flush=True)
        return card, os.path.exists(image)

    done = list(pool.map(one, info["cards"]))
    write_json(os.path.join(out, f"{set_id}.json"), strip({**info, "cards": [c for c, _ in done]}))
    print(f"{set_id}: {len(done)} kaarten, {new['cards']} nieuw, {new['images']} nieuwe plaatjes", flush=True)
    return info, {c["id"]: index_entry(c, has_image) for c, has_image in done}


def unknown_cards(labs, index):
    """Een ::warning::-regel per kaart in labs ([naam, setcode, nummer, sectie]) die de index niet kent.

    Een kaart is bekend als een van de sets van zijn code hem heeft; het nummer wordt localId (3 cijfers)."""
    return [f"::warning::{name} {code} {number} is not in site/cards/index.json. "
            "Run the \"Refresh cards\" workflow (Actions tab) to fetch new sets."
            for name, code, number, _ in labs["cards"]
            if not any(f"{s['id']}-{number.zfill(3)}" in index["cards"] for s in index["sets"].get(code, []))]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=DEFAULT_OUT, help="map voor de kaarten (standaard site/cards)")
    p.add_argument("--check-labs", metavar="LABS_JSON",
                   help="haal niets op, waarschuw voor kaarten in dit labs.json die <out>/index.json niet kent")
    a = p.parse_args(argv)
    if a.check_labs:
        with open(a.check_labs, encoding="utf-8") as f, open(os.path.join(a.out, "index.json"), encoding="utf-8") as g:
            warnings = unknown_cards(json.load(f), json.load(g))
        print("\n".join(warnings) or "All cards in labs.json are in the card index.")
        return
    os.makedirs(a.out, exist_ok=True)

    try:
        set_ids = [s["id"] for serie in SERIES for s in api(f"series/{serie}")["sets"]]
        legal = {name: {c["id"] for c in api(f"cards?legal.{name}=true")} for name in ("standard", "expanded")}
        print(f"{len(set_ids)} sets in {', '.join(SERIES)}", flush=True)
        sets, cards = {}, {}
        with ThreadPoolExecutor(WORKERS) as pool:
            for set_id in set_ids:
                info, entries = fetch_set(set_id, a.out, legal, pool)
                cards.update(entries)
                code = (info.get("abbreviation") or {}).get("official")
                if code:
                    sets.setdefault(code, []).append({"id": set_id, "releaseDate": info.get("releaseDate")})
                else:
                    print(f"  {set_id} heeft geen setcode (abbreviation.official)")
        for card_id in ENERGY_ART:
            set_id, local_id = card_id.rsplit("-", 1)
            image = os.path.join(a.out, set_id, f"{local_id}.webp")
            if not os.path.exists(image):
                os.makedirs(os.path.dirname(image), exist_ok=True)
                write(image, get(f"https://assets.tcgdex.net/en/swsh/{set_id}/{local_id}/low.webp"))
    except urllib.error.URLError as e:  # ook HTTPError
        sys.exit(f"TCGdex: {e} ({getattr(e, 'url', '')})")

    for code_sets in sets.values():
        code_sets.sort(key=lambda s: (s["releaseDate"] or "", s["id"]))
    write_json(os.path.join(a.out, "index.json"), {"sets": dict(sorted(sets.items())), "cards": cards,
                                                   "energyArt": {name: i for i, name in ENERGY_ART.items()}})
    print(f"index.json: {len(sets)} setcodes, {len(cards)} kaarten, "
          f"{sum(not c['image'] for c in cards.values())} zonder plaatje")


if __name__ == "__main__":
    main()
