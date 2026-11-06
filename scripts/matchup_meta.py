"""Gedeeld door de ophaalscripts: het seizoen uit de datum en hoe de scripts zich bij de bronnen melden.

Een seizoen begint op 1 augustus en heet naar het jaar waarin het eindigt (Season in GLOSSARY.md):
op 5 november 2026 loopt seizoen 2027, van 1 augustus 2026 tot en met 31 juli 2027.

"Vandaag" is de systeemdatum, of de datum (yyyy-mm-dd) in de omgevingsvariabele MATCHUP_META_TODAY;
daarmee testen de tests een andere dag.
"""
import datetime as dt
import os

SITE_URL = "https://guido-braam.github.io/matchup-meta/"
USER_AGENT = f"MatchupMeta/1.0 (+{SITE_URL})"


def today():
    value = os.environ.get("MATCHUP_META_TODAY")
    return dt.date.fromisoformat(value) if value else dt.date.today()


def season_of(day):
    """Het seizoen waarin deze dag valt: de laatste 1 augustus op of voor die dag, plus een jaar."""
    return day.year + 1 if (day.month, day.day) >= (8, 1) else day.year


def season_start(season):
    return dt.date(season - 1, 8, 1)


def season_end(season):
    return dt.date(season, 7, 31)
