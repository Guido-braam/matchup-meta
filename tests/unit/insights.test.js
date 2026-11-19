// Analysis: selection, summary and matchups on made-up Game records with known totals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { select, summary, matchups, oppDeckOf, record } from "../../site/js/insights.js";

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
