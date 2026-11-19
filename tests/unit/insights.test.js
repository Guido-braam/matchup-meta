// Analysis: selection, summary and matchups on made-up Game records with known totals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { select, summary, matchups, oppDeckOf, record, margin, prizeStats, firstOrSecond, mainPokemon, setupOnTime, prizeLeadByTurn, firstKnockOut, closeLosses, playInsights } from "../../site/js/insights.js";

const g = (result, wentFirst, oppDeck, { listId = "k", listVersion = 1, oppDeckSet = null } = {}) =>
  ({ listId, listVersion, oppDeck, oppDeckSet, game: { result, wentFirst } });

test("the correction wins over the automatic deck; an empty correction is Other", () => {
  assert.equal(oppDeckOf(g("win", true, "drag", { oppDeckSet: "gard" })), "gard");
  assert.equal(oppDeckOf(g("win", true, "drag", { oppDeckSet: "" })), null);
  assert.equal(oppDeckOf(g("win", true, "drag")), "drag");
});

test("select: one version, all versions, one opponent, Other", () => {
  const games = [g("win", true, "drag"), g("loss", true, "drag", { listVersion: 2 }), g("win", false, null), g("win", true, "drag", { listId: "x" })];
  assert.equal(select(games, { listId: "k" }).length, 3);
  assert.equal(select(games, { listId: "k", v: 1 }).length, 2);
  assert.equal(select(games, { listId: "k", v: 2 }).length, 1);
  assert.equal(select(games, { listId: "k", opp: "drag" }).length, 2);
  assert.equal(select(games, { listId: "k", opp: null }).length, 1);
});

test("summary and matchups", () => {
  const games = [g("win", true, "drag"), g("win", false, "drag"), g("loss", true, "drag"), g("loss", false, "gard"), g("win", true, "drag", { oppDeckSet: "gard" })];
  const s = summary(games);
  assert.equal(record(s), "3–2");
  assert.deepEqual([s.first, s.second], [{ wins: 2, losses: 1 }, { wins: 1, losses: 1 }]);
  assert.deepEqual(matchups(games), [{ deck: "drag", wins: 2, losses: 1 }, { deck: "gard", wins: 1, losses: 1 }]);
});

test("margin classes: every boundary, and a concession is never Close", () => {
  const m = (result, me, opp, reason = "prizes") => margin({ result, reason, prizes: { me, opp } });
  assert.deepEqual([m("win", 6, 2), m("win", 6, 3), m("win", 6, 4), m("win", 6, 5)], ["Dominant win", "Solid win", "Solid win", "Close win"]);
  assert.deepEqual([m("loss", 2, 6), m("loss", 3, 6), m("loss", 4, 6), m("loss", 5, 6)], ["Heavy loss", "Clear loss", "Clear loss", "Close loss"]);
  assert.deepEqual([m("win", 0, 0, "concede"), m("win", 4, 2, "concede"), m("win", 1, 3, "concede")], ["Solid win", "Dominant win", "Solid win"]);
  assert.deepEqual([m("loss", 3, 4, "concede"), m("loss", 1, 3, "concede")], ["Clear loss", "Heavy loss"]);
});

test("prize stats: averages, close games, count per class", () => {
  const p = (result, me, opp) => ({ game: { result, reason: "prizes", prizes: { me, opp } } });
  const s = prizeStats([p("win", 6, 5), p("loss", 5, 6), p("win", 6, 0)]);
  assert.deepEqual([s.me, s.opp, s.close], [17 / 3, 11 / 3, 2]);
  assert.equal(s.classes["Dominant win"], 1);
});

// Made-up games with a few events. Each game has my turns 1-4 and the opponent's turns 1-3 in order.
const turns = (extra = []) => {
  const ev = [];
  for (let t = 1; t <= 4; t++) {
    ev.push({ turnSide: "me", sideTurn: t, type: "end", side: "me" }, ...extra.filter(e => e.turnSide === "me" && e.sideTurn === t));
    if (t < 4) ev.push({ turnSide: "opp", sideTurn: t, type: "end", side: "opp" }, ...extra.filter(e => e.turnSide === "opp" && e.sideTurn === t));
  }
  return ev;
};
const play = (result, { wentFirst = true, extra = [], prizes = result === "win" ? { me: 6, opp: 3 } : { me: 3, opp: 6 }, oppDeck = "drag", setUp = false } = {}) =>
  ({ listId: "k", listVersion: 1, oppDeck, oppDeckSet: null, game: { result, wentFirst, reason: "prizes", prizes, events: turns(extra), setUp } });
const fakeReplay = game => game.events.map(() => ({ me: { active: game.setUp ? { name: "Mega Kangaskhan ex" } : null, bench: [] } }));
const atk = { turnSide: "me", sideTurn: 1, type: "attack", side: "me", pokemon: { name: "Mega Kangaskhan ex" } };
const times = (n, f) => Array.from({ length: n }, f);

test("insights need 5 games in each group, and are an early sign below 10", () => {
  assert.equal(firstOrSecond([...times(5, () => play("win")), ...times(4, () => play("loss", { wentFirst: false }))]), null);
  const r = firstOrSecond([...times(5, () => play("win")), ...times(5, () => play("loss", { wentFirst: false }))]);
  assert.equal(r.text, "Going first 5–0 · going second 0–5");
  assert.deepEqual([r.gap, r.early], [1, true]);
});

test("setup on time: the Pokémon that attacked most, in play by my turn 2", () => {
  const games = [...times(5, () => play("win", { setUp: true, extra: [atk] })), ...times(5, () => play("loss"))];
  assert.equal(mainPokemon(games), "Mega Kangaskhan ex");
  const r = setupOnTime(games, fakeReplay);
  assert.equal(r.text, "Mega Kangaskhan ex in play by your turn 2: 5 of 10 games · 5–0 when it was, 0–5 when it wasn't");
  assert.equal(r.card, "Mega Kangaskhan ex");
});

test("prize lead after my turn N, in wins against losses", () => {
  const mine = { turnSide: "me", sideTurn: 2, type: "prize", side: "me", count: 2 };
  const theirs = { turnSide: "opp", sideTurn: 1, type: "prize", side: "opp", count: 2 };
  const r = prizeLeadByTurn([...times(5, () => play("win", { extra: [mine] })), ...times(5, () => play("loss", { extra: [theirs] }))]);
  assert.equal(r.text, "After your turn 2: in losses you were 2.0 Prize cards behind on average, in wins 2.0 Prize cards ahead");
});

test("first Knock Out by the opponent before my turn 3, in losses against wins", () => {
  const ko = (turnSide, sideTurn) => ({ turnSide, sideTurn, type: "ko", side: "me", pokemon: { name: "Duskull" } });
  const games = [...times(5, () => play("loss", { extra: [ko("opp", 2)] })), ...times(4, () => play("win")), play("win", { extra: [ko("me", 3)] })];
  assert.equal(firstKnockOut(games).text, "The opponent took the first Knock Out before your turn 3 in 5 of 5 losses, and in 0 of 5 wins");
});

test("close losses per matchup, and at most 5 insights, largest gap first", () => {
  const games = [...times(3, () => play("loss", { prizes: { me: 5, opp: 6 } })), ...times(2, () => play("loss")), ...times(5, () => play("win", { wentFirst: false }))];
  assert.deepEqual(closeLosses(games, () => "Dragapult").map(r => r.text), ["Close losses vs Dragapult: 3 of 5"]);
  const all = playInsights(games, { replay: fakeReplay, deckName: () => "Dragapult" });
  assert.ok(all.length <= 5 && all.every((r, i) => !i || all[i - 1].gap >= r.gap));
  assert.equal(all[0].text, "Going first 0–5 · going second 5–0");
});
