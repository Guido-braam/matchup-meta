"""The season both fetchers use without a season argument, driven through the command line.

"Today" is set with MATCHUP_META_TODAY. A season starts on 1 August and carries the number of the
year it ends in (Season in GLOSSARY.md). The fixture cache holds three Regionals of season 2027, all
in September 2026; nothing of season 2028.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIMITLESS = ROOT / "scripts" / "limitless_labs_fetch.py"
TRAINERHILL = ROOT / "scripts" / "trainerhill_fetch.py"
FIXTURE_CACHE = ROOT / "tests" / "fixtures" / "limitless" / "raw"


def run(script, today, *args):
    return subprocess.run(
        [sys.executable, "-I", str(script), *args],
        env={**os.environ, "MATCHUP_META_TODAY": today},
        check=True, capture_output=True, text=True, encoding="utf-8")


def run_limitless(tmp_path, today, edit=None):
    """Run the Limitless fetcher offline without --season; return its output and the labs.json it wrote."""
    shutil.copytree(FIXTURE_CACHE, tmp_path / "raw")
    if edit:
        edit(tmp_path / "raw")
    app = tmp_path / "app"
    done = run(LIMITLESS, today, "--offline", "--no-ml", "--out", str(tmp_path), "--app-dir", str(app))
    return done.stdout, json.loads((app / "labs.json").read_text(encoding="utf-8"))


def move_to_season(season, *event_ids, type=None):
    """Edit for run_limitless: put these Regionals (default all) in another season, or make them another type."""
    def edit(raw):
        for path in raw.glob("*_tournament.json"):
            if event_ids and path.name[:4] not in event_ids:
                continue
            meta = json.loads(path.read_text(encoding="utf-8"))
            path.write_text(json.dumps({**meta, "season": season, "type": type or meta["type"]}), encoding="utf-8")
    return edit


def test_in_the_autumn_the_season_is_next_year(tmp_path):
    out, labs = run_limitless(tmp_path, "2026-11-05")
    assert labs["season"] == 2027
    assert [e["id"] for e in labs["events"]] == ["0072", "0073", "0074"]


def test_the_season_follows_the_date_without_a_yearly_edit(tmp_path):
    out, labs = run_limitless(tmp_path, "2027-11-05", edit=move_to_season(2028))
    assert labs["season"] == 2028
    assert [e["id"] for e in labs["events"]] == ["0072", "0073", "0074"]


def test_the_last_day_of_july_still_belongs_to_the_season(tmp_path):
    out, labs = run_limitless(tmp_path, "2027-07-31")
    assert labs["season"] == 2027
    assert "teruggevallen" not in out


def test_a_new_season_without_a_regional_shows_the_previous_one(tmp_path):
    # 1 August 2027 starts season 2028, which has no Regional yet.
    out, labs = run_limitless(tmp_path, "2027-08-01")
    assert labs["season"] == 2027
    assert [e["id"] for e in labs["events"]] == ["0072", "0073", "0074"]
    assert "Seizoen 2028 heeft nog geen afgeronde Regional; teruggevallen op seizoen 2027" in out


def test_a_new_season_with_one_regional_is_shown(tmp_path):
    out, labs = run_limitless(tmp_path, "2027-08-01", edit=move_to_season(2028, "0074"))
    assert labs["season"] == 2028
    assert [e["id"] for e in labs["events"]] == ["0074"]
    assert "teruggevallen" not in out


def test_only_a_regional_opens_the_new_season(tmp_path):
    out, labs = run_limitless(tmp_path, "2027-08-01", edit=move_to_season(2028, "0074", type="special"))
    assert labs["season"] == 2027
    assert [e["id"] for e in labs["events"]] == ["0072", "0073"]


def test_a_season_argument_is_used_as_given(tmp_path):
    shutil.copytree(FIXTURE_CACHE, tmp_path / "raw")
    app = tmp_path / "app"
    out = run(LIMITLESS, "2027-08-01", "--offline", "--no-ml", "--season", "2027",
              "--out", str(tmp_path), "--app-dir", str(app)).stdout
    assert json.loads((app / "labs.json").read_text(encoding="utf-8"))["season"] == 2027
    assert "teruggevallen" not in out


def trainerhill_filters(tmp_path, today, labs_season=None):
    """Run the Trainerhill fetcher with --dry-run (no network) and return the filters it would send."""
    app = tmp_path / "app"
    app.mkdir()
    if labs_season:
        (app / "labs.json").write_text(json.dumps({"season": labs_season}), encoding="utf-8")
    out = run(TRAINERHILL, today, "--dry-run", "--app-dir", str(app), "--out", str(tmp_path / "th")).stdout
    line = next(l for l in out.splitlines() if l.startswith("Filters: "))
    return json.loads(line.removeprefix("Filters: "))


def test_trainerhill_starts_at_the_season_start(tmp_path):
    filters = trainerhill_filters(tmp_path, "2026-11-05")
    assert (filters["start_date"], filters["end_date"]) == ("2026-08-01", "2026-11-05")


def test_trainerhill_follows_the_season_the_limitless_run_chose(tmp_path):
    # On 1 August 2027 the Limitless run fell back to 2027, so Trainerhill stays in that season too.
    filters = trainerhill_filters(tmp_path, "2027-08-20", labs_season=2027)
    assert (filters["start_date"], filters["end_date"]) == ("2026-08-01", "2027-07-31")


def test_trainerhill_without_labs_json_takes_the_season_from_the_date(tmp_path):
    filters = trainerhill_filters(tmp_path, "2027-08-20")
    assert (filters["start_date"], filters["end_date"]) == ("2027-08-01", "2027-08-20")


def test_trainerhill_start_and_end_arguments_still_win():
    out = run(TRAINERHILL, "2026-11-05", "--dry-run", "--start", "2026-09-01", "--end", "2026-10-01").stdout
    assert '"start_date": "2026-09-01", "end_date": "2026-10-01"' in out


def test_trainerhill_names_itself_with_the_site_address():
    out = run(TRAINERHILL, "2026-11-05", "--dry-run").stdout
    assert re.search(r"^User-Agent: MatchupMeta/1\.0 \(\+https://\S+/\)$", out, re.M)
