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
