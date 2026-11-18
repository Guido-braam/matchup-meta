// Insights (spec .scratch/battle-logs, "Insight catalogue"): from saved games to numbers. Pure.
// Ticket 08 (this part): record, winrate, win reasons, game length, first vs second, per opponent deck.
// Every rate comes with its sample size and a 95% Wilson interval.

// k successes out of n -> {k, n, p, lo, hi}; p null when n is 0.
export function wilson(k, n, z = 1.96) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / d, half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

// The opponent's deck of a saved game: the visitor's correction wins; "" or null is "Other".
export const oppDeckOf = g => (g.oppDeckSet ?? g.oppDeck) || null;

// Tournament winrate of deck a against deck b from data.json (Trainerhill: [i, j, wins, losses, ties]), or null.
// Ties count as 1/3 win, as on the rest of the site.
export function fieldRate(data, a, b) {
  if (!data || !a || !b) return null;
  const i = data.archetypes.findIndex(x => x.id === a), j = data.archetypes.findIndex(x => x.id === b);
  const m = i >= 0 && j >= 0 && data.matchups.find(x => x[0] === i && x[1] === j);
  if (!m) return null;
  const n = m[2] + m[3] + m[4];
  return n ? { p: (m[2] + m[4] / 3) / n, n } : null;
}

const rate = gs => wilson(gs.filter(g => g.game.result === "win").length, gs.length);

// games: saved Game records; myDeck: the deck id of the list (for the tournament winrate), or null.
export function overview(games, { data = null, myDeck = null } = {}) {
  const reasons = result => {
    const r = { prizes: 0, concede: 0, other: 0 };
    for (const g of games) if (g.game.result === result) r[g.game.reason in r ? g.game.reason : "other"]++;
    return r;
  };
  const byDeck = new Map();
  for (const g of games) { const d = oppDeckOf(g); byDeck.set(d, [...(byDeck.get(d) || []), g]); }
  const first = games.filter(g => g.game.wentFirst), second = games.filter(g => !g.game.wentFirst);
  return {
    games: games.length,
    record: rate(games),
    reasons: { win: reasons("win"), loss: reasons("loss") },
    avgTurns: games.length ? games.reduce((s, g) => s + g.game.turns, 0) / games.length : null,
    first: rate(first), second: rate(second),
    matchups: [...byDeck].map(([deck, gs]) => ({
      deck, record: rate(gs), first: rate(gs.filter(g => g.game.wentFirst)), field: fieldRate(data, myDeck, deck),
    })).sort((a, b) => b.record.n - a.record.n || (a.deck ?? "~").localeCompare(b.deck ?? "~")),
  };
}

// ---------- Insight catalogue (items 4-8; ticket 09) ----------
// A comparison splits the games in two groups and compares their winrates. It is only shown when both groups
// have at least MIN games, and the catalogue sorts by the gap, largest first (narrower ranges first on a tie).
// The UI says "goes with", never "causes": these are correlations in the visitor's own games.
export const MIN = 10;

// Card names compared loosely: case, accents, apostrophes and "Basic " before an Energy do not matter.
export const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`]/g, "").replace(/^basic (?=.*energy$)/, "").replace(/\s+/g, " ").trim();

// -> {subject, yes, no, gap, ...extra} or null. subject: what splits the games ("Ultra Ball played by your turn 2").
export function compare(games, subject, inYes, extra = {}) {
  const yes = games.filter(inYes), no = games.filter(g => !inYes(g));
  if (yes.length < MIN || no.length < MIN) return null;
  const a = rate(yes), b = rate(no);
  return { subject, yes: a, no: b, gap: a.p - b.p, ...extra };
}
const width = r => r.yes.hi - r.yes.lo + r.no.hi - r.no.lo;
const byGap = (a, b) => Math.abs(b.gap) - Math.abs(a.gap) || width(a) - width(b);

// The turn (my own count: 0 = setup, 1 = my first turn) each card was first played from my hand: Map norm -> {name, turn}.
// Played = put into play, attached from the hand (not from the deck by another card), evolved, or an Item,
// Supporter or Stadium played. Played in the opponent's turn (rare) counts as my last turn.
export function firstPlayed(game) {
  const out = new Map();
  for (const e of game.events) {
    if (e.side !== "me" || !e.card || !["play", "attach", "evolve"].includes(e.type) || (e.type === "attach" && e.sub)) continue;
    const k = norm(e.card.name);
    if (!out.has(k)) out.set(k, { name: e.card.name, turn: e.turnSide === "me" ? e.sideTurn : 0 });
  }
  return out;
}
// Cards of mine the log names (opening hand, drawn, searched, played, discarded): Set of norm names.
export function knownMine(game) {
  const s = new Set(game.openingHand.map(c => norm(c.name)));
  for (const e of game.events) {
    if (e.side !== "me" || e.type === "counters") continue;
    (e.cards || []).forEach(c => s.add(norm(c.name)));
    if (e.card) s.add(norm(e.card.name));
  }
  return s;
}

// Item 4. Per card of the list: share of games it showed up (my known cards), share played, average turn first
// played. rare: showed up in at least half the games but played in at most a fifth of those. never: not played
// in the last LAST games (games newest first). Needs MIN games.
export const LAST = 20;
export function cardUsage(games, cards) {
  if (games.length < MIN) return [];
  const known = games.map(g => knownMine(g.game)), played = games.map(g => firstPlayed(g.game)), recent = Math.min(LAST, games.length);
  return cards.map(c => {
    const k = norm(c.name), shown = known.filter(s => s.has(k)).length;
    const turns = played.map(p => p.get(k)?.turn).filter(t => t != null);
    return {
      name: c.name, count: c.count ?? null, games: games.length,
      shown: shown / games.length, played: turns.length / games.length,
      avgTurn: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : null,
      rare: shown / games.length >= 0.5 && turns.length <= shown / 5,
      never: !played.slice(0, recent).some(p => p.has(k)), recent,
    };
  });
}

// Item 5. Card played by my turn N (1, 2 or 3) or not; per card only the N with the largest gap.
export function playedByTurn(games, names) {
  const played = new Map(games.map(g => [g, firstPlayed(g.game)]));
  return names.map(name => {
    const k = norm(name);
    return [1, 2, 3].map(n => compare(games, `${name} played by your turn ${n}`, g => (played.get(g).get(k)?.turn ?? 99) <= n, { card: name }))
      .filter(Boolean).sort(byGap)[0];
  }).filter(Boolean);
}

// Item 6. Opening hand: Pokémon in play after setup, mulligans, each card in the opening hand.
const setupPokemon = game => game.events.filter(e => e.turn === 0 && e.side === "me" && (e.type === "play" || e.type === "search-play"))
  .reduce((n, e) => n + (e.type === "play" ? 1 : e.count), 0);
export function openingHand(games) {
  const names = new Map();
  for (const g of games) for (const c of g.game.openingHand) names.set(norm(c.name), c.name);
  return [
    compare(games, "Two or more Pokémon in play after setup", g => setupPokemon(g.game) >= 2),
    compare(games, "You took a mulligan", g => g.game.mulligans.me > 0),
    compare(games, "Your opponent took a mulligan", g => g.game.mulligans.opp > 0),
    ...[...names].map(([k, name]) => compare(games, `${name} in your opening hand`, g => g.game.openingHand.some(c => norm(c.name) === k), { card: name })),
  ].filter(Boolean);
}

// Item 7. Prize race: who took the first Prize card; overall and per opponent deck.
const firstPrize = game => game.events.find(e => e.type === "prize")?.side ?? null;
export function prizeRace(games) {
  const decks = [...new Set(games.map(oppDeckOf))];
  return [
    compare(games, "You took the first Prize card", g => firstPrize(g.game) === "me"),
    ...(decks.length < 2 ? [] : decks).map(d => compare(games.filter(g => oppDeckOf(g) === d), "You took the first Prize card", g => firstPrize(g.game) === "me", { deck: d })),
  ].filter(Boolean);
}

// Item 8a. Per opponent deck with MIN games or more: which of my Pokémon is Knocked Out first, most often first.
export function firstDown(games) {
  const by = new Map();
  for (const g of games) by.set(oppDeckOf(g), [...(by.get(oppDeckOf(g)) || []), g]);
  return [...by].filter(([, gs]) => gs.length >= MIN).map(([deck, gs]) => {
    const n = new Map();
    for (const g of gs) { const ko = g.game.events.find(e => e.type === "ko" && e.side === "me"); if (ko) n.set(ko.pokemon.name, (n.get(ko.pokemon.name) || 0) + 1); }
    return { deck, games: gs.length, top: [...n].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3) };
  }).filter(r => r.top.length);
}

// Item 8b. An opponent's Pokémon I Knock Out by my turn 2, against the games where they had it and I did not.
const earlyKOs = game => game.events.filter(e => e.type === "ko" && e.side === "opp" && e.turnSide === "me" && e.sideTurn <= 2);
const theirPokemon = game => new Set(game.events.filter(e => e.side === "opp")
  .flatMap(e => (["play", "evolve"].includes(e.type) && e.card ? [e.card] : e.type === "search-play" ? e.cards || [] : [])).map(c => norm(c.name)));
export function earlyKnockOuts(games) {
  const early = new Map(games.map(g => [g, new Set(earlyKOs(g.game).map(e => norm(e.pokemon.name)))]));
  const names = new Map(games.flatMap(g => earlyKOs(g.game)).map(e => [norm(e.pokemon.name), e.pokemon.name]));
  return [...names].map(([k, name]) => {
    const pool = games.filter(g => early.get(g).has(k) || theirPokemon(g.game).has(k));
    return compare(pool, `You Knocked Out their ${name} by your turn 2`, g => early.get(g).has(k), { card: name });
  }).filter(Boolean);
}

// All of it. cards: the picked list version's cards (items 4 and 5), or null when no list is picked.
export function catalogue(games, { cards = null } = {}) {
  return {
    usage: cards ? cardUsage(games, cards) : [],
    insights: [...(cards ? playedByTurn(games, cards.map(c => c.name)) : []), ...openingHand(games), ...prizeRace(games), ...earlyKnockOuts(games)].sort(byGap),
    firstDown: firstDown(games),
  };
}
