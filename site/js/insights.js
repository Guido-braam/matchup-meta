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

// The turning point of a lost game: the Prize card after which I was behind until the end (the last time the
// Prize count went from level or ahead to behind). -> {k: event index, turn, mine, sideTurn, ko, count} or null.
export function turningPoint(game) {
  if (game.result !== "loss") return null;
  let lead = 0, at = -1;
  game.events.forEach((e, i) => {
    if (e.type !== "prize") return;
    const before = lead;
    lead += e.side === "me" ? e.count : -e.count;
    if (before >= 0 && lead < 0) at = i;
  });
  if (lead >= 0 || at < 0) return null;
  const e = game.events[at];
  const ko = game.events.slice(0, at).reverse().find(x => x.type === "ko" && x.side === "me" && x.turn === e.turn);
  return { k: at, turn: e.turn, mine: e.turnSide === "me", sideTurn: e.sideTurn, ko: ko?.pokemon.name ?? null, count: e.count };
}

// ---------- Turn into advice (spec "Turn into advice") ----------
// A game turn by turn in short lines, from my side ("you" / "opp"). No player names and no log text.
const act = e => {
  const n = c => c?.name ?? "?";
  switch (e.type) {
    case "play": return `played ${n(e.card)}`;
    case "search-play": return `put ${(e.cards || []).map(n).join(", ")} into play`;
    case "attach": return `attached ${n(e.card)} to ${n(e.pokemon)}`;
    case "evolve": return `evolved ${n(e.from)} into ${n(e.card)}`;
    case "attack": return `${n(e.pokemon)} used ${e.attack}${e.target ? ` on ${n(e.target.pokemon)}` : ""}${e.damage ? ` for ${e.damage}` : ""}`;
    case "ko": return `${e.side === "me" ? "your" : "opp's"} ${n(e.pokemon)} Knocked Out`;
    case "prize": return `${e.side === "me" ? "you" : "opp"} took ${e.count} Prize card${e.count === 1 ? "" : "s"}`;
    case "retreat": return `retreated ${n(e.pokemon)}`;
    case "active": return `${n(e.pokemon)} to Active`;
    default: return null;
  }
};
export function gameSummary(g, deckName) {
  const G = g.game, lines = [`${margin(G)} vs ${deckName(oppDeckOf(g))} · went ${G.wentFirst ? "first" : "second"} · Prize cards ${G.prizes.me}–${G.prizes.opp} · ${G.turns} turns` +
    `${G.reason === "concede" ? ` · ${G.result === "win" ? "opp" : "you"} conceded` : ""}${G.mulligans?.me ? ` · you took ${G.mulligans.me} mulligan(s)` : ""}`];
  if (G.openingHand?.length) lines.push(`Opening hand: ${G.openingHand.map(c => c.name).join(", ")}`);
  const turns = new Map();
  for (const e of G.events) {
    const a = act(e);
    if (!a) continue;
    const k = e.turn ? `T${e.turn} ${e.turnSide === "me" ? "you" : "opp"}` : "Setup";
    turns.set(k, [...(turns.get(k) || []), e.turn && e.side && e.side !== e.turnSide && e.type !== "ko" && e.type !== "prize" ? `(${e.side === "me" ? "you" : "opp"}) ${a}` : a]);
  }
  for (const [k, as] of turns) lines.push(`${k}: ${as.join("; ")}`);
  return lines.join("\n");
}

export const ADVICE_GAMES = 20;
export const ADVICE_SYSTEM = `You are an experienced Pokémon TCG coach (Standard format). A player sends their own results with one deck from Pokémon TCG Live: the numbers of a selection of games, short turn-by-turn summaries of the newest games, and the rules text of the cards in their list and of the cards their opponents showed.
Give advice on how to play this deck better: sequencing, what to set up first, which Pokémon to put forward or keep back, how to take Prize cards in each matchup, when to use which attack or ability. Do not advise changing the list (cards to add or cut): the player asked only about play.
Base every point on the data and the card texts: name the turns, games or numbers it comes from. Do not make up cards, games or numbers. With few games, say a point is a first sign.
Write in English, in Markdown: a heading per theme (for example "Setup", "Prize trade", one heading per opponent deck that stands out), and under it as many short, concrete points as are useful. No introduction and no summary at the end.`;

// The message for Claude. sel: the games of the selection; insights: playInsights(); label: "Cursed Dive v2 vs All opponents";
// cards: {mine: [card text], theirs: [card text]}.
export function adviceMessages(sel, { label, insights, deckName, cards }) {
  const s = summary(sel), p = prizeStats(sel);
  const games = [...sel].sort((a, b) => b.added.localeCompare(a.added)).slice(0, ADVICE_GAMES);
  const text = [
    `# ${label}`,
    `Record ${record(s)} · going first ${record(s.first)} · going second ${record(s.second)}`,
    `Prize cards per game: you ${p.me.toFixed(1)}, opponent ${p.opp.toFixed(1)}. Margin classes: ${MARGINS.filter(m => p.classes[m]).map(m => `${m} ${p.classes[m]}`).join(", ")}`,
    `Matchups: ${matchups(sel).map(m => `${deckName(m.deck)} ${record(m)}`).join(", ")}`,
    insights.length ? `## Insights\n${insights.map(r => `- ${r.text}${r.early ? " (early sign)" : ""}`).join("\n")}` : "",
    `## My cards\n${cards.mine.map(t => `- ${t}`).join("\n")}`,
    `## Opponents' cards seen\n${cards.theirs.map(t => `- ${t}`).join("\n")}`,
    `## The ${games.length} newest games, turn by turn\n${games.map((g, i) => `### Game ${i + 1}\n${gameSummary(g, deckName)}`).join("\n\n")}`,
  ].filter(Boolean).join("\n\n");
  return [{ role: "user", content: `${text}\n\nHow can I play this deck better?` }];
}
