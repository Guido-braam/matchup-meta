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
