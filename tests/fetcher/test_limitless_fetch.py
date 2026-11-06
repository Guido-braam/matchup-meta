"""The Limitless fetcher as a command-line tool: offline, no model, on the fixture cache.

The fixture cache (tests/fixtures/limitless/raw) holds three Regionals of seven players each:

    place  Baltimore (US)  Brisbane (AU)  Frankfurt (DE)
    1      Basic Box       Dragapult      Dragapult
    2      Dragapult       N's Zoroark    Festival Lead
    3      N's Zoroark     Crustle        Basic Box
    4      Dragapult       Basic Box      Dragapult
    5      Other           (no deck)      N's Zoroark
    6      N's Zoroark     Dragapult      Other
    7      Crustle         Basic Box      Festival Lead

With --top 6 the seventh player of each Regional is not counted. Brisbane and Frankfurt
start on the same day; Baltimore eight days earlier.
"""
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FETCHER = ROOT / "scripts" / "limitless_labs_fetch.py"
FIXTURE_CACHE = ROOT / "tests" / "fixtures" / "limitless" / "raw"
TOP = "6"


def run_fetcher(tmp_path, *extra, edit=None):
    """Copy the fixture cache to tmp_path/raw, run the fetcher offline and return the parsed labs.json."""
    shutil.copytree(FIXTURE_CACHE, tmp_path / "raw")
    if edit:
        edit(tmp_path / "raw")
    app = tmp_path / "app"
    subprocess.run(
        [sys.executable, "-I", str(FETCHER), "--offline", "--no-ml", "--season", "2027", "--top", TOP,
         "--out", str(tmp_path), "--app-dir", str(app), *extra],
        check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads((app / "labs.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def labs(tmp_path_factory):
    return run_fetcher(tmp_path_factory.mktemp("fetch"))


def deck(labs, deck_id):
    return next(a for a in labs["archetypes"] if a["id"] == deck_id)


def test_each_deck_carries_its_top_players_per_regional(labs):
    assert [e["id"] for e in labs["events"]] == ["0072", "0073", "0074"]
    counts = {a["id"]: a["counts"] for a in labs["archetypes"]}
    assert counts == {
        "dragapult-ex": [2, 2, 2],
        "basic-box-m": [1, 1, 1],
        "n-zoroark": [2, 1, 1],
        "other": [1, 0, 1],
        "crustle-dri": [0, 1, 0],
        "festival-lead": [0, 0, 1],
    }


def test_each_regional_carries_its_top_players_counted(labs):
    assert [e["players"] for e in labs["events"]] == [6, 6, 6]


def test_each_regional_carries_its_continent(labs):
    assert [e["continent"] for e in labs["events"]] == ["na", "oce", "eu"]


def test_a_regional_outside_the_five_zones_has_no_continent(tmp_path):
    def move_brisbane_to_japan(raw):
        path = raw / "0073_tournament.json"
        meta = json.loads(path.read_text(encoding="utf-8"))
        path.write_text(json.dumps({**meta, "country": "JP"}), encoding="utf-8")

    labs = run_fetcher(tmp_path, edit=move_brisbane_to_japan)
    assert [e["continent"] for e in labs["events"]] == ["na", None, "eu"]


def test_a_european_regional_weighs_the_same_as_any_other(labs):
    # Festival Lead has one counted player in Frankfurt, Crustle one in Brisbane, on the same day.
    assert deck(labs, "festival-lead")["share"] == deck(labs, "crustle-dri")["share"]
    # Dragapult has two of the six counted players everywhere.
    assert deck(labs, "dragapult-ex")["share"] == pytest.approx(1 / 3, abs=1e-5)


def test_no_europe_fields_are_written(tmp_path, labs):
    assert "europe_weight" not in labs["settings"]
    for event in labs["events"]:
        assert "europe" not in event and "weight" not in event
    run_fetcher(tmp_path)
    with open(tmp_path / "events.csv", encoding="utf-8") as f:  # what the recommended-list model reads
        header = next(csv.reader(f))
    assert "europe" not in header and "weight" not in header


def test_the_europe_weight_option_is_gone(tmp_path):
    with pytest.raises(subprocess.CalledProcessError):
        run_fetcher(tmp_path, "--europe-weight", "1.5")


def test_recency_halves_every_30_days_from_the_newest_regional(labs):
    assert [e["recency"] for e in labs["events"]] == [0.8312, 1.0, 1.0]  # Baltimore is 8 days older


def test_the_file_states_its_season_and_when_it_was_generated(labs):
    assert labs["season"] == 2027
    assert labs["generated"]


def test_the_browser_fixture_is_the_fetcher_output_on_the_fixture_cache(labs):
    """The smoke test's labs.json comes from this same cache; regenerate it as tests/README.md says."""
    committed = json.loads((ROOT / "tests" / "fixtures" / "labs.json").read_text(encoding="utf-8"))
    assert {**committed, "generated": None} == {**labs, "generated": None}
