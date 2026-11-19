"""The TCGdex fetcher (scripts/tcgdex_fetch.py) on fixture responses, without the network.

`fixtures/tcgdex.json` maps API paths to responses, cut down from real ones: SVI with Pineco and
Pokégear 3.0 (made ACE SPEC here to test the flag), and the code 30C on two sets, 30th (Pikachu) and
30th-c (Charizard, which has no image, as on TCGdex). The fetcher's one network function, `get`, is
replaced by a stub that answers from the fixture and records every URL.
"""
import importlib.util
import json
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "tcgdex.json").read_text(encoding="utf-8"))
spec = importlib.util.spec_from_file_location("tcgdex_fetch", ROOT / "scripts" / "tcgdex_fetch.py")
tcgdex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tcgdex)


@pytest.fixture
def calls(monkeypatch):
    urls = []

    def get(url):
        urls.append(url)
        if url.endswith("/low.webp"):
            return b"webp:" + url.encode()
        return json.dumps(FIXTURE[url.removeprefix(tcgdex.API + "/")]).encode()

    monkeypatch.setattr(tcgdex, "get", get)
    return urls


def run(out):
    tcgdex.main(["--out", str(out)])
    return json.loads((out / "index.json").read_text(encoding="utf-8"))


def keys(x):
    """Every key at every level."""
    if isinstance(x, dict):
        return set(x) | set().union(*map(keys, x.values()))
    if isinstance(x, list):
        return set().union(*map(keys, x))
    return set()


def test_pricing_and_updated_stripped_everywhere(tmp_path, calls):
    run(tmp_path)
    sv01 = json.loads((tmp_path / "sv01.json").read_text(encoding="utf-8"))
    assert not keys(sv01) & {"pricing", "updated"}
    pineco = sv01["cards"][0]
    assert pineco["hp"] == 60 and [v["type"] for v in pineco["variants_detailed"]] == ["normal", "reverse"]
    assert sv01["abbreviation"] == {"official": "SVI"}


def test_index(tmp_path, calls):
    index = run(tmp_path)
    assert index["sets"] == {
        "30C": [{"id": "30th", "releaseDate": "2026-09-16"}, {"id": "30th-c", "releaseDate": "2026-09-16"}],
        "SVI": [{"id": "sv01", "releaseDate": "2023-03-31"}],
    }
    assert index["cards"] == {
        "sv01-001": {"name": "Pineco", "category": "Pokemon", "stage": "Basic", "image": True},
        "sv01-186": {"name": "Pokégear 3.0", "category": "Trainer", "trainerType": "Item", "aceSpec": True, "image": True},
        "30th-001": {"name": "Pikachu", "category": "Pokemon", "stage": "Basic", "image": True},
        "30th-c-001": {"name": "Charizard", "category": "Pokemon", "stage": "Stage2", "image": False},
    }
    assert (tmp_path / "sv01" / "186.webp").read_bytes() == b"webp:https://assets.tcgdex.net/en/sv/sv01/186/low.webp"
    assert list((tmp_path / "30th-c").iterdir()) == []
    assert index["energyArt"]["Grass Energy"] == "swsh12.5-152" and len(index["energyArt"]) == 8
    assert (tmp_path / "swsh12.5" / "152.webp").read_bytes() == b"webp:https://assets.tcgdex.net/en/swsh/swsh12.5/152/low.webp"


def test_legal_comes_from_the_legal_lists(tmp_path, calls):
    run(tmp_path)
    cards = {c["id"]: c for c in json.loads((tmp_path / "30th.json").read_text(encoding="utf-8"))["cards"]}
    assert cards["30th-001"]["legal"] == {"standard": True, "expanded": True}


def test_second_run_fetches_no_cards_or_images(tmp_path, calls):
    run(tmp_path)
    first = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    calls.clear()
    FIXTURE["cards?legal.standard=true"].append({"id": "sv01-001"})  # Pineco becomes Standard-legal
    try:
        run(tmp_path)
    finally:
        FIXTURE["cards?legal.standard=true"].pop()
    assert not [u for u in calls if "/cards/" in u or u.endswith(".webp")]
    assert sorted(u.removeprefix(tcgdex.API + "/") for u in calls) == sorted([
        "series/sv", "series/me", "cards?legal.standard=true", "cards?legal.expanded=true",
        "sets/sv01", "sets/30th", "sets/30th-c"])
    pineco = json.loads((tmp_path / "sv01.json").read_text(encoding="utf-8"))["cards"][0]
    assert pineco["legal"] == {"standard": True, "expanded": True}
    assert {p for p in tmp_path.rglob("*") if p.is_file()} == set(first)


def test_image_missing_on_tcgdex_is_no_image(tmp_path, calls, monkeypatch):
    """A card can name an image TCGdex does not have (sv10-028 in November 2026)."""
    stub = tcgdex.get

    def get(url):
        if url.endswith("/186/low.webp"):
            raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
        return stub(url)

    monkeypatch.setattr(tcgdex, "get", get)
    assert run(tmp_path)["cards"]["sv01-186"]["image"] is False


def test_http_error_exits_non_zero(tmp_path, monkeypatch):
    def get(url):
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)

    monkeypatch.setattr(tcgdex, "get", get)
    with pytest.raises(SystemExit) as e:
        tcgdex.main(["--out", str(tmp_path)])
    assert e.value.code not in (0, None)


def check_labs(tmp_path, capsys, cards):
    """Runs --check-labs on a labs.json with these cards against the fixture's card index; returns the warnings."""
    index = {"sets": {"SVI": [{"id": "sv01"}], "30C": [{"id": "30th"}, {"id": "30th-c"}]},
             "cards": {"sv01-001": {}, "sv01-186": {}, "30th-001": {}, "30th-c-002": {}}}
    (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")
    (tmp_path / "labs.json").write_text(json.dumps({"cards": cards}), encoding="utf-8")
    tcgdex.main(["--out", str(tmp_path), "--check-labs", str(tmp_path / "labs.json")])  # returns, never exits
    return [line for line in capsys.readouterr().out.splitlines() if line.startswith("::warning::")]


def test_check_labs_all_known_no_warning(tmp_path, capsys):
    # unpadded numbers; 30C 2 only exists in the second set of the code
    assert check_labs(tmp_path, capsys, [["Pineco", "SVI", "1", 0], ["Pokégear 3.0", "SVI", "186", 1],
                                         ["Pikachu", "30C", "1", 0], ["Charizard", "30C", "2", 0]]) == []


def test_check_labs_one_unknown_card_one_warning(tmp_path, capsys):
    warnings = check_labs(tmp_path, capsys, [["Pineco", "SVI", "1", 0], ["Pineco", "SVI", "2", 0]])
    assert len(warnings) == 1 and "Pineco SVI 2" in warnings[0] and "Refresh cards" in warnings[0]


def test_check_labs_unknown_set_code(tmp_path, capsys):
    assert len(check_labs(tmp_path, capsys, [["Ditto", "NEW", "1", 0]])) == 1


def test_only_basic_energy_names_are_normal_energy():
    entry = lambda name, kind: tcgdex.index_entry({"name": name, "category": "Energy", "energyType": kind}, True)
    assert entry("Grass Energy", "Normal")["energyType"] == "Normal"
    assert entry("Basic Darkness Energy", "Normal")["energyType"] == "Normal"
    assert entry("Prism Energy", "Normal")["energyType"] == "Special"  # TCGdex says Normal
    assert entry("Growing Grass Energy", "Normal")["energyType"] == "Special"
    assert entry("Mist Energy", "Special")["energyType"] == "Special"


def test_search_json_has_only_standard_legal_versions(tmp_path, calls):
    run(tmp_path)
    rows = json.loads((tmp_path / "search.json").read_text(encoding="utf-8"))
    assert [r["id"] for r in rows] == ["30th-001"]  # only Pikachu is on the Standard list
    assert rows[0]["name"] == "Pikachu" and rows[0]["category"] == "Pokemon" and "image" not in rows[0]


def card(id, name, cat="Pokemon", text="", rarity="Common", standard=True):
    c = {"id": id, "name": name, "category": cat, "rarity": rarity, "legal": {"standard": standard}}
    c["attacks" if cat == "Pokemon" else "effect"] = [{"name": "Hit", "effect": text}] if cat == "Pokemon" else text
    return c


RELEASED = {"old": "2023-01-01", "new": "2025-01-01", "newer": "2026-01-01"}


def ids(cards):
    return [r["id"] for r in tcgdex.search_rows(cards, RELEASED)]


def test_search_pokemon_one_row_per_name_and_text():
    assert ids([card("old-001", "Pikachu", text="A"), card("new-001", "Pikachu", text="A"),
                card("new-002", "Pikachu", text="B")]) == ["new-001", "new-002"]


def test_search_trainer_one_row_per_name_with_text_of_newest_print():
    rows = tcgdex.search_rows([card("old-001", "Ultra Ball", "Trainer", "Old wording."),
                               card("new-001", "Ultra Ball", "Trainer", "New wording."),
                               card("newer-001", "Ultra Ball", "Trainer", "")], RELEASED)
    assert [(r["id"], r["text"]) for r in rows] == [("newer-001", "New wording.")]


def test_search_legal_by_name_and_illegal_left_out():
    # the old print is not on the Standard list, its reprint is: one row, the newest print
    assert ids([card("old-001", "Pokégear 3.0", "Trainer", "X", standard=False),
                card("new-001", "Pokégear 3.0", "Trainer", "X")]) == ["new-001"]
    assert ids([card("new-001", "Iono", "Trainer", "X", standard=False)]) == []


def test_search_newest_regular_print_over_fancy_lowest_id_on_tie():
    assert ids([card("new-001", "Boss's Orders", "Trainer", "X"),
                card("newer-200", "Boss's Orders", "Trainer", "X", rarity="Hyper rare"),
                card("newer-150", "Boss's Orders", "Trainer", "X", rarity="Ultra Rare")]) == ["new-001"]
    assert ids([card("new-002", "Nest Ball", "Trainer", "X"), card("new-001", "Nest Ball", "Trainer", "X")]) == ["new-001"]


def test_search_basic_energy_is_one_card():
    rows = tcgdex.search_rows([card("old-001", "Basic Fire Energy", "Energy"), card("new-001", "Fire Energy", "Energy")], RELEASED)
    assert [(r["id"], r["name"], r["energyType"]) for r in rows] == [("new-001", "Fire Energy", "Normal")]
