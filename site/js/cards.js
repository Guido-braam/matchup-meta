// Cards module: de Card index (cards/index.json, ADR 0005) laden en er een Card in opzoeken.
// findCard is puur (index erin, kaart eruit); loadCardIndex is de dunne lader eromheen.

// Naam vergelijkbaar maken: kleine letters, zonder accenten en apostrofs, enkele spaties.
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`]/g, "").replace(/\s+/g, " ").trim();

// Levenshtein-afstand: het minste aantal letters invoegen, weglaten of vervangen.
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Een naam mag zo'n deel van zijn lengte afwijken van de kaartnaam ("Boss Orders" -> Boss's Orders).
const MAX_DIFF = 0.15;

// TCGdex-id "<set id>-<localId>"; set ids kunnen zelf een streepje hebben (30th-c), dus splitsen op het laatste.
const splitId = id => { const k = id.lastIndexOf("-"); return { setId: id.slice(0, k), localId: id.slice(k + 1) }; };

const withId = (index, id) => ({ id, ...index.cards[id] });

// Per index één keer: release date per set id en per genormaliseerde naam de kaart uit de nieuwste set.
const byNameCache = new WeakMap();
function byName(index) {
  if (byNameCache.has(index)) return byNameCache.get(index);
  const released = {};
  for (const sets of Object.values(index.sets)) for (const s of sets) released[s.id] = s.releaseDate || "";
  const names = new Map();
  for (const [id, card] of Object.entries(index.cards)) {
    const key = norm(card.name);
    const date = released[splitId(id).setId] ?? "";
    // Bij gelijke datum blijft de eerste staan (laagste nummer in de set).
    if (!names.has(key) || date > names.get(key).date) names.set(key, { id, date });
  }
  byNameCache.set(index, names);
  return names;
}

// Card zoeken: eerst set code + nummer (elke set onder die code), anders op naam (exact, dan dichtstbijzijnd).
// Geeft {id, name, category, ..., image} of null.
export function findCard(index, setCode, number, name) {
  if (!index) return null;
  const localId = String(number ?? "").trim().padStart(3, "0");
  for (const s of index.sets[String(setCode ?? "").toUpperCase()] || []) {
    if (index.cards[`${s.id}-${localId}`]) return withId(index, `${s.id}-${localId}`);
  }
  if (!name) return null;
  const names = byName(index), key = norm(name);
  if (names.has(key)) return withId(index, names.get(key).id);
  // ponytail: lineaire scan over ~5000 namen per zoekactie; een prefix-index als dat merkbaar traag wordt.
  let best = null, bestDist = Math.floor(key.length * MAX_DIFF) + 1;
  for (const [n, hit] of names) {
    if (Math.abs(n.length - key.length) >= bestDist) continue;
    const d = editDistance(key, n);
    if (d < bestDist) { best = hit; bestDist = d; }
  }
  return best ? withId(index, best.id) : null;
}

// Pad van het plaatje van een Card (id = TCGdex-id), relatief aan de site; alleen geldig als card.image waar is.
export const cardImagePath = id => { const { setId, localId } = splitId(id); return `cards/${setId}/${localId}.webp`; };

// De Card index één keer per paginalading ophalen; elke aanroep krijgt dezelfde promise. Mislukt het, dan null.
let indexReq = null;
export function loadCardIndex(fetchFn = globalThis.fetch) {
  indexReq ??= fetchFn("cards/index.json").then(r => r.ok ? r.json() : null).catch(() => null);
  return indexReq;
}
