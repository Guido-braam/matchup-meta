// Insights: the analysis overview on made-up Game records with known totals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wilson, overview, fieldRate, oppDeckOf } from "../../site/js/insights.js";

const g = (result, wentFirst, oppDeck, { reason = "prizes", turns = 8, oppDeckSet = null } = {}) =>
  ({ oppDeck, oppDeckSet, game: { result, wentFirst, reason, turns } });
const DATA = { archetypes: [{ id: "kanga" }, { id: "drag" }, { id: "gard" }], matchups: [[0, 1, 60, 30, 9], [1, 0, 30, 60, 9]] };

test("Wilson interval: known values, and nothing for no games", () => {
  const w = wilson(7, 10);
  assert.equal(w.p, 0.7);
  assert.ok(Math.abs(w.lo - 0.3968) < 1e-3 && Math.abs(w.hi - 0.8922) < 1e-3);
  assert.deepEqual([wilson(0, 5).lo, wilson(5, 5).hi], [0, 1]);
  assert.equal(wilson(0, 0).p, null);
});

test("tournament winrate: ties count a third, unknown decks give null", () => {
  assert.equal(fieldRate(DATA, "kanga", "drag").p, (60 + 3) / 99);
  assert.equal(fieldRate(DATA, "kanga", "drag").n, 99);
  assert.equal(fieldRate(DATA, "kanga", "gard"), null);
  assert.equal(fieldRate(DATA, null, "drag"), null);
  assert.equal(fieldRate(null, "kanga", "drag"), null);
});

test("the correction wins over the automatic deck; an empty correction is Other", () => {
  assert.equal(oppDeckOf(g("win", true, "drag", { oppDeckSet: "gard" })), "gard");
  assert.equal(oppDeckOf(g("win", true, "drag", { oppDeckSet: "" })), null);
  assert.equal(oppDeckOf(g("win", true, "drag")), "drag");
});

test("overview: record, reasons, length, first and second, per opponent deck", () => {
  const games = [
    g("win", true, "drag", { turns: 6 }), g("win", false, "drag", { reason: "concede", turns: 10 }),
    g("loss", true, "drag", { turns: 8 }), g("loss", false, "gard", { reason: "concede", turns: 4 }),
    g("win", true, "drag", { oppDeckSet: "gard", turns: 12 }), g("loss", false, null, { reason: "other", turns: 2 }),
  ];
  const o = overview(games, { data: DATA, myDeck: "kanga" });
  assert.equal(o.games, 6);
  assert.deepEqual([o.record.k, o.record.n], [3, 6]);
  assert.deepEqual(o.reasons, { win: { prizes: 2, concede: 1, other: 0 }, loss: { prizes: 1, concede: 1, other: 1 } });
  assert.equal(o.avgTurns, 7);
  assert.deepEqual([o.first.k, o.first.n, o.second.k, o.second.n], [2, 3, 1, 3]);
  // Most games first: drag 3 (2-1), gard 2 (1-1), Other 1.
  assert.deepEqual(o.matchups.map(m => [m.deck, m.record.k, m.record.n]), [["drag", 2, 3], ["gard", 1, 2], [null, 0, 1]]);
  assert.deepEqual([o.matchups[0].first.k, o.matchups[0].first.n], [1, 2]);
  assert.equal(o.matchups[0].field.p, 63 / 99);
  assert.equal(o.matchups[1].field, null);
});

test("overview of no games is empty, not broken", () => {
  const o = overview([]);
  assert.equal(o.record.p, null);
  assert.equal(o.avgTurns, null);
  assert.deepEqual(o.matchups, []);
});
