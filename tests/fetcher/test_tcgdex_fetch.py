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


def test_http_error_exits_non_zero(tmp_path, monkeypatch):
    def get(url):
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)

    monkeypatch.setattr(tcgdex, "get", get)
    with pytest.raises(SystemExit) as e:
        tcgdex.main(["--out", str(tmp_path)])
    assert e.value.code not in (0, None)
