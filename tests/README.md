# Tests

Everything here stays outside `site/`, so GitHub Pages never serves it.

## Fixture data (`fixtures/`)

A small, committed stand-in for the real data files, in the same shape as `site/data.json` (Trainerhill) and `site/labs.json` (Limitless Labs).

`data.json` was cut from the real Trainerhill file of October 2026: 7 decks, Dragapult, N's Zoroark, Basic Box, Festival Lead, Crustle, Other (not a deck), and Gengar, which was not played at the Regionals, so its default comes from Trainerhill. Sprites are a 1×1 pixel image.

`labs.json` is not edited by hand: the Limitless fetcher writes it from the fixture cache in `fixtures/limitless/raw/` (the fetcher's own `<out>/raw/` format), so the data contract is checked from both sides, by pytest and by the browser smoke test. The cache holds 3 Regionals on different continents, Baltimore (US), Brisbane (AU) and Frankfurt (DE), of 7 players each; their decklists are real lists from those Regionals, but players, placements and pairings are made up (the table is in `fetcher/test_limitless_fetch.py`). With `--top 6` the seventh player of each Regional is not counted.

The fixture is generated with `--no-ml`, so no deck has a recommended list (`ml`): the model needs hundreds of lists per deck and would find nothing in 7 players. The smoke test does not check the recommended list, so it stays green; a test that needs `ml` should add it to the cache's Regionals or run the model on a bigger cut.

After changing the cache or the fetcher, regenerate `labs.json` (the CSVs it also writes next to the cache are gitignored):

```bash
python -I scripts/limitless_labs_fetch.py --offline --no-ml --season 2027 --top 6 --out tests/fixtures/limitless --app-dir tests/fixtures
```

Extend the fixture rather than starting a second one; tests for the calculation and the fetcher can read the same files.

## Fetcher tests (`fetcher/`)

pytest runs `scripts/limitless_labs_fetch.py` as a command-line tool, `--offline --no-ml`, on a copy of the fixture cache, and checks the `labs.json` it writes: top players per deck per Regional, the continent of each Regional, recency, no Europe weighting (ADR 0003), and that the committed `fixtures/labs.json` is exactly what the fetcher makes of the cache (apart from `generated`).

`fetcher/test_season.py` checks the season both scripts pick without a season argument (the rule lives in `scripts/matchup_meta.py`). The tests set "today" with the environment variable `MATCHUP_META_TODAY` (yyyy-mm-dd) and edit the season or type of the cached Regionals in their copy: the current season when it has a Regional, the previous one when it has none, and the 1 August boundary. The Trainerhill fetcher needs the network, so its tests use `--dry-run`, which prints the season, the filters (start and end date) and the User-Agent and stops. The same works by hand:

```bash
MATCHUP_META_TODAY=2027-08-01 python -I scripts/limitless_labs_fetch.py --offline --no-ml --out tests/fixtures/limitless
python -I scripts/trainerhill_fetch.py --app-dir site --dry-run
```

`fetcher/test_tcgdex_fetch.py` runs `scripts/tcgdex_fetch.py` (ADR 0005) on `fixtures/tcgdex.json`, cut-down TCGdex responses keyed by API path, by replacing the script's one network function `get` with a stub that records every URL. It checks that `pricing` and `updated` are stripped at every level, the card index format, the set code 30C mapping to two sets, a card without image recorded as such, legality taken from the legal lists, a second run that fetches no card or image, and a non-zero exit on an HTTP error.

Run locally (Python 3.14; `.venv/` is gitignored):

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest
```

On macOS or Linux the venv's Python is `.venv/bin/python`. `requirements-dev.txt` also holds numpy and pandas, which the recommended-list model (`scripts/labs_ml.py`) needs when the fetcher runs without `--no-ml`.

## Calculation, storage and AI modules (`unit/`)

`site/js/calc.js` turns the parsed data files plus a visitor's settings into My meta, expected winrates and the tier list, without touching the page. `unit/calc.test.js` tests it through its one function, `computeMeta(data, labs, settings)`, on the fixture data: share from the per-Regional counts (recency-weighted top players on the deck over recency-weighted top players counted), with Regionals on the chosen continent counting 1.5 times, Worldwide counting all equally, and a continent without Regionals in the season falling back to Worldwide; the default frequency level thresholds (5%, 2.5%, 1%, 0.4%, 0.1%), the Trainerhill fallback for decks not played at the Regionals, the expected winrate for a given My meta, and the tier assignment. It also tests the Settings file through `exportSettings(settings)` and `importSettings(text)`: an export holds only `{ version, continent, localFrequencies }` and imports back the same, local frequencies for decks not in the data are kept and count again when the deck returns, and a file of another version, with an unknown continent, an invalid frequency level or that is not JSON is rejected with a message. Expected values are worked out by hand in the test comments.

`site/js/storage.js` keeps what the site remembers in the visitor's browser (ADR 0002). `unit/storage.test.js` tests it through `createStorage(backend)` on an in-memory stand-in for localStorage: Settings are stored as `{ version: 1, localFrequencies, continent }` under `matchup-meta-settings`, load back the same, a missing or unknown continent is Worldwide (so Settings saved before the continent existed still load), only valid frequency levels are loaded, anything unreadable or of another version gives the defaults, and storage that is blocked, missing or throwing gives the defaults while saving reports failure. The visitor's API key (`matchup-meta-api-key`) and Advice history (`matchup-meta-advice`, newest first, at most 10) are stored under their own keys, outside Settings, so an export of Settings never carries them; removing the key is one call, and unreadable history entries are left out. Deck chat history (`matchup-meta-deck-chat`, per deck the last 30 messages) is stored the same way, under its own key, with unreadable messages left out.

`site/js/ai.js` calls the Anthropic Messages API straight from the browser with the visitor's own key (ADR 0002). `unit/ai.test.js` tests it through `createAI(apiKey, { fetch })` with a stand-in for `fetch`, so no real API call is made and no key is needed: the request shape (URL, headers including `anthropic-version` and `anthropic-dangerous-direct-browser-access`, model `claude-opus-5-5`, effort `medium`, the JSON schema in `output_config.format`), the parsed answer, and an error code for each kind of failure: a rejected key, an organization that blocks browser calls, billing, rate limits, overload, server errors, no connection, Stop, a refusal, a cut-off answer and an answer that is not JSON. For Deck chat it tests `chat()` on streamed answers (server-sent events, built by the test): the text arrives in pieces, the deck's context goes in `system` with `stream: true`; when Claude calls the list-check tool the module runs it and sends Claude's turn back unchanged (thinking block and signature included) with the tool result; a tool that throws or gets unreadable JSON input reports an error result to Claude instead of stopping; and a rejected key, an error event mid-stream, a refusal and Stop each give their code while keeping the text written so far.

Run locally (no install needed, only Node):

```bash
npm run test:unit
```

The workflow runs these in the job `unit`.

## Browser smoke test (`e2e/`)

Playwright loads the site through `e2e/fixture-server.js`, which serves `site/` as is but answers `data.json` and `labs.json` from `fixtures/`. The site files themselves are not changed. The tests check that the tier list renders without console errors, that a deck page opens, that Deck Lab checks a pasted list, that every view shows the footer with the update dates and season from the fixture files (and copes without `labs.json`), and that no view scrolls sideways at phone width (375px). For Settings they check that a local frequency and its tier list survive a reload, that resetting a local frequency restores the default and removes it from storage, and that the site loads with defaults and without errors when localStorage is blocked or every call on it throws (simulated with an init script). Export then import restores the same Settings (stored Settings, continent and tier list, also after a reload) after they were changed in between, and the downloaded file holds no API key or Advice history (both seeded in localStorage first); an invalid file shows a message and leaves Settings as they were. For the continent they check that changing it changes a default frequency level and the tier cut-offs while local frequencies stay and the choice survives a reload, that a continent without Regionals shows a note and uses Worldwide, and that the lists on a deck page stay the same. In the fixture every deck played at the Regionals is above 5% for any continent, so these tests serve `labs.json` with 16 top players counted per Regional instead of 6 (through `page.route`; the fixture file is not changed), which makes Crustle Regularly Worldwide and Often for Oceania. The calculation tests use the same variant. For the API key they check that without a key Advice and Deck chat are off with an explanation, the tier list still works and nothing is sent to Anthropic; that a saved key turns Advice on, that Advice sends the visitor's key with an English prompt and English field names, survives a reload and stays out of Settings, and that Remove key deletes the key and turns both features off again; and that a rejected key shows a readable error. For Deck chat with a key they check that a streamed answer appears, that the list-check tool runs (the stub first asks for `check_list`, then answers with a list) and its result goes back to Claude, that the prompt is English, that the chat survives a reload and stays out of Settings, that no claude.ai runtime is used, and that a rejected key shows a readable error. The Messages API route is stubbed in those tests (with its CORS preflight); real API calls are never tested automatically. Other outside requests are blocked (Google Fonts gets an empty stylesheet).

Run locally:

```bash
npm ci
npx playwright install chromium
npx playwright test
```

Add `--headed` to watch the browser. To look at the site with the fixture data yourself: `node tests/e2e/fixture-server.js` and open http://127.0.0.1:8771/.

The spec file is named `*.spec.js`, so `node --test` (which looks for `*.test.js` files) does not pick it up; `playwright.config.js` only looks in `tests/e2e/`.

The workflow `.github/workflows/tests.yml` runs these tests on every pull request (job `browser-smoke`), next to the fetcher tests (job `fetcher`) and the calculation module tests (job `unit`); a failing test fails the PR check and its Playwright trace is kept as an artifact.
