// Calculation module: My meta, expected winrate and tiers from the parsed data files.
// No DOM access: plain data in (data.json, labs.json, settings), plain data out.

// level = frequency level, weight = gewicht in de berekening (elke stap 3x zo zwaar, zoals in de echte meta).
export const LEVELS = [
  { level: 5, weight: 81 },
  { level: 4, weight: 27 },
  { level: 3, weight: 9 },
  { level: 2, weight: 3 },
  { level: 1, weight: 1 },
  { level: 0, weight: 0 },
];
const WEIGHT = Object.fromEntries(LEVELS.map(l => [l.level, l.weight]));
// Weinig games: winrate trekken naar 50% alsof er 20 extra games van 50% bij komen.
const PRIOR_GAMES = 20;
// Gunstigheid van één matchup: <= 45% telt als 0, >= 55% als 1, daartussen naar rato.
const favor = p => Math.min(1, Math.max(0, (p - 0.45) / 0.10));

// Standaard "hoe vaak" op basis van het aandeel in de toernooidata.
const defaultLevel = share => {
  const p = share * 100;
  return p >= 5 ? 5 : p >= 2.5 ? 4 : p >= 1 ? 3 : p >= 0.4 ? 2 : p >= 0.1 ? 1 : 0;
};

// Worldwide en de vijf Play! Pokémon-zones; id = continent zoals in labs.json events[].
export const CONTINENTS = [
  { id: "worldwide", name: "Worldwide" },
  { id: "na", name: "North America" },
  { id: "latam", name: "Latin America" },
  { id: "eu", name: "Europe" },
  { id: "oce", name: "Oceania" },
  { id: "mesa", name: "Middle East & South Africa" },
];
// Regionals op het gekozen continent tellen zo veel zwaarder mee in het aandeel (ADR 0003).
const CONTINENT_FACTOR = 1.5;

// Gewicht per Regional (continent x recency) en de gewogen top players die geteld zijn.
function regionalWeights(events, continent) {
  const w = events.map(e => (e.continent === continent ? CONTINENT_FACTOR : 1) * e.recency);
  return { w, den: events.reduce((t, e, k) => t + w[k] * e.players, 0) };
}

// Aandeel op de Regionals uit de top players per Regional; decks die daar niet gespeeld zijn volgen Trainerhill.
function defaultShare(a, labsById, { w, den }) {
  const l = labsById.get(a.id);
  if (!l || !den) return { share: a.share, source: "trainerhill" };
  return { share: l.counts.reduce((t, n, k) => t + w[k] * n, 0) / den, source: "regionals" };
}

// matchups[i][j]: deck i tegen deck j, of null zonder games. p = winrate (gelijkspel telt als 1/3 winst),
// pa = winrate naar 50% getrokken, die de berekening gebruikt.
function matchupTable(data) {
  const n = data.archetypes.length;
  const table = Array.from({ length: n }, () => Array(n).fill(null));
  for (const [i, j, w, l, t] of data.matchups) {
    const g = w + l + t;
    if (g) table[i][j] = { w, l, t, g, p: (w + t / 3) / g, pa: (w + t / 3 + PRIOR_GAMES / 2) / (g + PRIOR_GAMES) };
  }
  return table;
}

// Per deck, gewogen naar hoe vaak je elke tegenstander tegenkomt:
//  fav = kans op een gunstige matchup, exp = verwachte winrate.
function rating(row, weights) {
  let fav = 0, exp = 0, den = 0, any = false;
  weights.forEach((w, j) => {
    if (!w) return;
    const m = row[j];
    if (m) any = true;
    // Nooit tegen dit deck gespeeld: onbekend, dus telt als 50%.
    const p = m ? m.pa : 0.5;
    fav += w * favor(p); exp += w * p; den += w;
  });
  return den && any ? { fav: fav / den, exp: exp / den } : null;
}

// Tiers op de verwachte winrate tegen jouw meta; share = welk deel van de ranking in die tier valt.
const TIERS = [
  { tier: "S", share: 0.10 }, { tier: "A", share: 0.15 }, { tier: "B", share: 0.25 },
  { tier: "C", share: 0.25 }, { tier: "D", share: 0.15 }, { tier: "E", share: 0.10 },
];
const NOT_A_DECK = new Set(["other"]);

// Dense ranking: decks met dezelfde winrate (op 0,1 procentpunt) delen een plek, zonder gaten.
// Plek 1 is de beste; de bovenste 10% van de plekken is S, de volgende 15% A, enzovoort.
// Alleen decks die je tegenkomt tellen mee; de grenzen gelden daarna voor alle decks.
// Geeft per tier de ondergrens (min); de onderste tier heeft geen ondergrens (-1).
function tierBounds(decks) {
  const vals = new Map();
  decks.forEach(d => {
    if (NOT_A_DECK.has(d.id) || d.level === 0 || !d.rating) return;
    const key = Math.round(d.rating.exp * 1000);
    vals.set(key, Math.min(vals.get(key) ?? 1, d.rating.exp));
  });
  const keys = [...vals.keys()].sort((x, y) => y - x), n = keys.length;
  let cum = 0, prev = 1;
  return TIERS.map(({ tier, share }, k) => {
    if (k === TIERS.length - 1) return { tier, min: -1 };
    cum += share;
    // Laagste waarde waarvan het midden van de plek nog binnen deze tier valt.
    let low = null;
    keys.forEach((key, d) => { if ((d + 0.5) / n <= cum + 1e-9) low = vals.get(key); });
    prev = low == null ? prev : Math.min(low, prev);
    return { tier, min: prev };
  });
}

// settings.localFrequencies: deckId -> frequency level, alleen voor decks die afwijken van de standaard.
// settings.continent: id uit CONTINENTS (standaard Worldwide); bepaalt het aandeel en zo de standaardniveaus.
// Geeft per deck (in de volgorde van data.archetypes) het niveau, de verwachte winrate en de tier,
// plus de tiergrenzen, de matchuptabel en het continent: gekozen en gebruikt.
export function computeMeta(data, labs, settings = {}) {
  const local = settings.localFrequencies || {};
  const labsById = new Map((labs?.archetypes || []).map(a => [a.id, a]));
  const events = labs?.events || [], chosen = settings.continent || "worldwide";
  // Zonder Regionals op het gekozen continent in dit seizoen telt alles Worldwide.
  const continent = { chosen, used: events.some(e => e.continent === chosen) ? chosen : "worldwide" };
  const matchups = matchupTable(data), rw = regionalWeights(events, continent.used);
  const decks = data.archetypes.map(a => {
    const share = defaultShare(a, labsById, rw), def = defaultLevel(share.share);
    const level = a.id in local ? local[a.id] : def;
    return { id: a.id, name: a.name, defaultShare: share, defaultLevel: def, level, weight: WEIGHT[level] };
  });
  const weights = decks.map(d => d.weight);
  decks.forEach((d, i) => { d.rating = rating(matchups[i], weights); });
  const tiers = tierBounds(decks);
  decks.forEach(d => {
    d.isDeck = !NOT_A_DECK.has(d.id);
    d.tier = d.rating ? tiers.find(t => d.rating.exp >= t.min).tier : null;
  });
  return { decks, tiers, matchups, continent };
}

// Settings = {localFrequencies, continent}; het bestand en localStorage dragen hetzelfde versienummer.
// Bij een andere vorm van Settings het versienummer ophogen en de oude vorm hier en in storage.js omzetten.
export const SETTINGS_VERSION = 1;

// Export: alleen Settings, nooit de API key, Advice, Deck chat of Deck Lab.
export const exportSettings = ({ localFrequencies, continent }) =>
  JSON.stringify({ version: SETTINGS_VERSION, continent, localFrequencies }, null, 2);

// Import: {ok: true, settings} of {ok: false, error}. Alles wordt gecontroleerd voordat er iets verandert;
// local frequencies voor decks die nu niet in de data staan blijven, zodat ze terugkomen met het deck.
export function importSettings(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { ok: false, error: "This file is not a Matchup Meta settings file (no valid JSON)." }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "This file is not a Matchup Meta settings file." };
  if (o.version !== SETTINGS_VERSION) return { ok: false, error: `Unsupported settings version: ${JSON.stringify(o.version)} (expected ${SETTINGS_VERSION}).` };
  if (!CONTINENTS.some(c => c.id === o.continent)) return { ok: false, error: `Unknown continent: ${JSON.stringify(o.continent)}.` };
  const f = o.localFrequencies;
  if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, error: "The local frequencies are missing." };
  const bad = Object.entries(f).find(([, lv]) => !(lv in WEIGHT) || !Number.isInteger(lv));
  if (bad) return { ok: false, error: `Invalid frequency level for ${bad[0]}: ${JSON.stringify(bad[1])}.` };
  return { ok: true, settings: { localFrequencies: { ...f }, continent: o.continent } };
}
