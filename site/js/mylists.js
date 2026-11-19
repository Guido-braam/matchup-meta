// My lists (spec .scratch/battle-logs): the lists a visitor saves in Deck Lab to link games to. Pure.
// A list: {id, name, deck, archived, versions: [{v, text, cards: [{id?, name, count}], created}]}.
// A version with games is frozen: saving a change then adds a version (ADR 0006, glossary "List version").
import { findCard } from "./cards.js";

export const latest = list => list.versions[list.versions.length - 1];

export const newList = ({ name, deck, text, cards }, now = new Date().toISOString()) =>
  ({ id: crypto.randomUUID(), name, deck, archived: false, versions: [{ v: 1, text, cards, created: now }] });

const key = cards => cards.map(c => `${c.id || c.name}:${c.count}`).sort().join("|");

// -> {list, saved: "same" | "updated" | "new-version"}. The list passed in is not changed.
export function saveVersion(list, { text, cards }, frozen, now = new Date().toISOString()) {
  const cur = latest(list);
  if (key(cur.cards) === key(cards)) return { list, saved: "same" };
  const versions = frozen
    ? [...list.versions, { v: cur.v + 1, text, cards, created: now }]
    : [...list.versions.slice(0, -1), { ...cur, text, cards }];
  return { list: { ...list, versions }, saved: frozen ? "new-version" : "updated" };
}

// What changed between two card lists, by name: {out: [[name, n]], in: [[name, n]]}, each A–Z.
export function cardDiff(before, after) {
  const d = new Map();
  for (const c of before) d.set(c.name, (d.get(c.name) || 0) - c.count);
  for (const c of after) d.set(c.name, (d.get(c.name) || 0) + c.count);
  const all = [...d].sort(([a], [b]) => a.localeCompare(b));
  return { out: all.filter(([, n]) => n < 0).map(([k, n]) => [k, -n]), in: all.filter(([, n]) => n > 0) };
}

// The deck of a list: the deck in labs.json whose Pokémon look most like the list's Pokémon (cosine on copies,
// the deck's side weighted by how many players run each card). Trainers and Energy say little about the deck.
// -> {id, name} or null when nothing comes close.
const MIN_SIMILARITY = 0.6;
const norm = s => String(s).toLowerCase();
const decksCache = new WeakMap();
function deckVectors(labs, index) {
  if (decksCache.has(labs)) return decksCache.get(labs);
  const isMon = labs.cards.map(([name, set, num]) => findCard(index, set, num, name)?.category === "Pokemon");
  const out = labs.archetypes.filter(a => a.usage?.length).map(a => {
    const v = new Map();
    for (const [i, share, , avg] of a.usage) if (isMon[i]) {
      const n = norm(labs.cards[i][0]);
      v.set(n, (v.get(n) || 0) + share * avg);
    }
    return { id: a.id, name: a.name, v };
  });
  decksCache.set(labs, out);
  return out;
}
const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; dot += x * (b.get(k) || 0); }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
export function deckOf(cards, labs, index) {
  if (!labs || !index) return null;
  const mine = new Map();
  for (const c of cards) {
    const card = (c.id && index.cards[c.id]) || findCard(index, "", "", c.name);
    if (card?.category === "Pokemon") mine.set(norm(c.name), (mine.get(norm(c.name)) || 0) + c.count);
  }
  let best = null, bestScore = MIN_SIMILARITY;
  for (const d of deckVectors(labs, index)) {
    const s = cosine(mine, d.v);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return best && { id: best.id, name: best.name };
}
