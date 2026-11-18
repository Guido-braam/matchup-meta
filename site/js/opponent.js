// Reconstruction of a deck from one game (spec .scratch/battle-logs, glossary "Reconstruction"). Pure.
// Works for either side; My games uses it for the opponent: the cards they showed, the copies proven,
// how many of the 60 are unknown, the most similar Regional lists in labs.json and the deck.
import { cardsSeen } from "./mygames.js";

const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`]/g, "").replace(/^basic (?=.*energy$)/, "").replace(/\s+/g, " ").trim();
const isBasicEnergy = name => /^(basic )?\w+ energy$/i.test(name) && !/neo upper|ignition|jet|mist|legacy|luminous|prism|reversal|enriching|boomerang|spiky|team rocket|telepath|growing|rocky|gift/i.test(name);

// Minimum copies proven per card: every time a card goes into play (Bench, Active, evolved into, attached),
// is played from hand, or is discarded from hand, that is one more copy; cards seen in another way count once.
// ponytail: a card brought back (Super Rod, Night Stretcher) and played again counts twice; capped at 4
// (no cap for basic Energy). Tracking every copy through the zones would come with the game-state engine.
export function provenCopies(game, side) {
  const n = new Map();
  const add = c => { if (c?.name) n.set(norm(c.name), { c, k: (n.get(norm(c.name))?.k || 0) + 1 }); };
  for (const e of game.events) {
    if (e.side !== side) continue;
    if (e.type === "play" || e.type === "attach" || e.type === "evolve") add(e.card);
    if (e.type === "search-play") (e.cards || []).forEach(add);
    if (e.type === "discard" && !e.from) (e.cards || []).forEach(add);
  }
  const out = cardsSeen(game, side).map(c => {
    const k = Math.max(1, n.get(norm(c.name))?.k || 0);
    return { ...c, copies: isBasicEnergy(c.name) ? k : Math.min(4, k) };
  });
  return out.sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name));
}

// How much of what was seen a list explains: copies seen that the list has, over all copies seen.
function score(seen, list, names) {
  const have = new Map();
  for (const [i, k] of list.cards) have.set(names[i], (have.get(names[i]) || 0) + k);
  let hit = 0, all = 0;
  for (const c of seen) { all += c.copies; hit += Math.min(c.copies, have.get(norm(c.name)) || 0); }
  return all ? hit / all : 0;
}

const MIN_SCORE = 0.8;
// -> {seen, known, unknown, similar: [{deckId, deckName, event, place, of, score, cards}] (best 3), deck: id or null}.
// The deck is the best list's deck only when it explains at least 80% and no list of another deck does as well:
// a game where only Ultra Ball and Boss's Orders were seen says nothing about the deck.
export function reconstruct(game, labs, side = "opp") {
  const seen = provenCopies(game, side);
  const known = seen.reduce((s, c) => s + c.copies, 0);
  const out = { seen, known, unknown: Math.max(0, 60 - known), similar: [], deck: null };
  if (!labs || !seen.length) return out;
  const names = labs.cards.map(c => norm(c[0]));
  const ranked = labs.archetypes.flatMap(a => (a.lists || []).map(l => ({ a, l, s: score(seen, l, names) })))
    .sort((x, y) => y.s - x.s || x.l.place - y.l.place);
  out.similar = ranked.slice(0, 3).map(({ a, l, s }) => ({
    deckId: a.id, deckName: a.name, event: (labs.events[l.e]?.name || "").replace(/^Regional Championship /, ""),
    place: l.place, of: l.of, score: Math.round(s * 1000) / 1000, cards: l.cards,
  }));
  const best = ranked[0], rival = ranked.find(r => r.a.id !== best?.a.id);
  if (best && best.s >= MIN_SCORE && (!rival || best.s > rival.s)) out.deck = best.a.id;
  return out;
}
