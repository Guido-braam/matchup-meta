// Analysis (spec .scratch/analysis-rework): from saved games to the numbers on the Analysis tab. Pure.

// Card names compared loosely: case, accents, apostrophes and "Basic " before an Energy do not matter.
export const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`]/g, "").replace(/^basic (?=.*energy$)/, "").replace(/\s+/g, " ").trim();

// The opponent's deck of a saved game: the visitor's correction wins; "" or null is "Other" (null).
export const oppDeckOf = g => (g.oppDeckSet ?? g.oppDeck) || null;

// The games of one list: one version (v a number) or all versions (v "all"); opp: undefined = all opponents,
// null = Other, else a deck id.
export function select(games, { listId, v = "all", opp } = {}) {
  return games.filter(g => g.listId === listId && (v === "all" || g.listVersion === v) && (opp === undefined || oppDeckOf(g) === opp));
}

const won = g => g.game.result === "win";
const wl = gs => ({ wins: gs.filter(won).length, losses: gs.filter(g => !won(g)).length });
export const record = r => `${r.wins}–${r.losses}`;

// Record, going first, going second.
export function summary(games) {
  return { ...wl(games), first: wl(games.filter(g => g.game.wentFirst)), second: wl(games.filter(g => !g.game.wentFirst)) };
}

// Per opponent deck, most games first: [{deck, wins, losses}].
export function matchups(games) {
  const by = new Map();
  for (const g of games) by.set(oppDeckOf(g), [...(by.get(oppDeckOf(g)) || []), g]);
  return [...by].map(([deck, gs]) => ({ deck, ...wl(gs) }))
    .sort((a, b) => b.wins + b.losses - a.wins - a.losses || (a.deck ?? "~").localeCompare(b.deck ?? "~"));
}

// Margin class of a game, by the Prize lead of the winner at the end (spec "Margin class"). A concession is never
// Close: a lead of 2 or more is Dominant win / Heavy loss, else Solid win / Clear loss.
export const MARGINS = ["Dominant win", "Solid win", "Close win", "Close loss", "Clear loss", "Heavy loss"];
export function margin(game) {
  const { me, opp } = game.prizes, win = game.result === "win", lead = win ? me - opp : opp - me;
  const k = game.reason === "concede" ? (lead >= 2 ? 0 : 1) : lead >= 4 ? 0 : lead >= 2 ? 1 : 2;
  return MARGINS[win ? k : 5 - k];
}
// Average Prize cards taken per game, the number of close games, and the count per margin class.
export function prizeStats(games) {
  const n = games.length || 1, classes = Object.fromEntries(MARGINS.map(m => [m, 0]));
  for (const g of games) classes[margin(g.game)]++;
  return {
    me: games.reduce((s, g) => s + g.game.prizes.me, 0) / n, opp: games.reduce((s, g) => s + g.game.prizes.opp, 0) / n,
    close: classes["Close win"] + classes["Close loss"], classes,
  };
}

// ---------- Insights about play (spec "Insights") ----------
// Each insight compares groups of games; it shows only when every group has MIN games, and is an "early sign"
// below EARLY. -> {text, gap, early, card?} or null. gap: how much the groups differ (0-1), for the order.
export const MIN = 5, EARLY = 10, MAX_INSIGHTS = 5, MIN_GAP = 0.1; // below MIN_GAP the groups hardly differ: not shown
const share = gs => (gs.length ? gs.filter(won).length / gs.length : 0);
const enough = (...groups) => groups.every(g => g.length >= MIN);
const early = (...groups) => Math.min(...groups.map(g => g.length)) < EARLY;

// The index of the last event of my turn n, or the last event when the game ended before it.
function endOfMyTurn(game, n) {
  let k = -1;
  game.events.forEach((e, i) => { if (e.turnSide === "me" && e.sideTurn === n) k = i; });
  return k < 0 ? game.events.length - 1 : k;
}
// The index of the first event of my turn n, or the number of events when the game ended before it.
function startOfMyTurn(game, n) {
  const k = game.events.findIndex(e => e.turnSide === "me" && e.sideTurn >= n);
  return k < 0 ? game.events.length : k;
}
// Prize cards I took minus those the opponent took, up to and including event k.
const leadAt = (game, k) => game.events.slice(0, k + 1).reduce((s, e) => s + (e.type === "prize" ? (e.side === "me" ? e.count : -e.count) : 0), 0);

export function firstOrSecond(games) {
  const a = games.filter(g => g.game.wentFirst), b = games.filter(g => !g.game.wentFirst);
  if (!enough(a, b)) return null;
  return { text: `Going first ${record(wl(a))} · going second ${record(wl(b))}`, gap: Math.abs(share(a) - share(b)), early: early(a, b) };
}

// My Pokémon that attacked most often in these games (Knock Outs in the log do not name the attacker).
export function mainPokemon(games) {
  const n = new Map();
  for (const g of games) for (const e of g.game.events) if (e.type === "attack" && e.side === "me") n.set(e.pokemon.name, (n.get(e.pokemon.name) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
// Is a Pokémon of mine with this name in play (Active or Bench) at the end of my turn n? states: replay(game).
export const inPlayBy = (game, states, name, n) => {
  const s = states[endOfMyTurn(game, n)]?.me;
  return !!s && [s.active, ...s.bench].some(m => m && norm(m.name) === norm(name));
};
export function setupOnTime(games, replay, n = 2) {
  const name = mainPokemon(games);
  if (!name) return null;
  const yes = games.filter(g => inPlayBy(g.game, replay(g.game), name, n)), no = games.filter(g => !yes.includes(g));
  if (!enough(yes, no)) return null;
  return { text: `${name} in play by your turn ${n}: ${yes.length} of ${games.length} games · ${record(wl(yes))} when it was, ${record(wl(no))} when it wasn't`,
    gap: Math.abs(share(yes) - share(no)), early: early(yes, no), card: name };
}

// Prize lead after my turn 2, 3 or 4 in wins against losses; the turn where they differ most.
const leadText = x => (Math.abs(x) < 0.05 ? "level on Prize cards" : `${Math.abs(x).toFixed(1)} Prize cards ${x < 0 ? "behind" : "ahead"}`);
export function prizeLeadByTurn(games) {
  const w = games.filter(won), l = games.filter(g => !won(g));
  if (!enough(w, l)) return null;
  const avg = (gs, n) => gs.reduce((s, g) => s + leadAt(g.game, endOfMyTurn(g.game, n)), 0) / gs.length;
  const best = [2, 3, 4].map(n => ({ n, w: avg(w, n), l: avg(l, n) })).sort((a, b) => (b.w - b.l) - (a.w - a.l))[0];
  // ponytail: a Prize difference is put on the 0-1 scale as diff / 6, so it sorts next to winrate gaps.
  return { text: `After your turn ${best.n}: in losses you were ${leadText(best.l)} on average, in wins ${leadText(best.w)}`,
    gap: Math.min(1, Math.abs(best.w - best.l) / 6), early: early(w, l) };
}

// Who took the first Knock Out, before my turn 3: the opponent, in losses against wins.
const theyKOdFirstEarly = game => {
  const k = game.events.findIndex(e => e.type === "ko");
  return k >= 0 && game.events[k].side === "me" && k < startOfMyTurn(game, 3);
};
export function firstKnockOut(games) {
  const w = games.filter(won), l = games.filter(g => !won(g));
  if (!enough(w, l)) return null;
  const kl = l.filter(g => theyKOdFirstEarly(g.game)).length, kw = w.filter(g => theyKOdFirstEarly(g.game)).length;
  return { text: `The opponent took the first Knock Out before your turn 3 in ${kl} of ${l.length} losses, and in ${kw} of ${w.length} wins`,
    gap: Math.abs(kl / l.length - kw / w.length), early: early(w, l) };
}

// Close losses per opponent deck with MIN losses or more: near misses, where a better plan pays off most.
export function closeLosses(games, deckName) {
  return matchups(games).filter(m => m.losses >= MIN).map(m => {
    const l = games.filter(g => oppDeckOf(g) === m.deck && !won(g)), c = l.filter(g => margin(g.game) === "Close loss").length;
    return { text: `Close losses vs ${deckName(m.deck)}: ${c} of ${l.length}`, gap: c / l.length, early: l.length < EARLY };
  });
}

// The insights of a selection, largest gap first, at most MAX_INSIGHTS. replay: gamestate.js replay().
export function playInsights(games, { replay, deckName }) {
  return [firstOrSecond(games), setupOnTime(games, replay), prizeLeadByTurn(games), firstKnockOut(games), ...closeLosses(games, deckName)]
    .filter(r => r && r.gap >= MIN_GAP).sort((a, b) => b.gap - a.gap).slice(0, MAX_INSIGHTS);
}
