// The insight catalogue (items 4-8), each on made-up games with a known answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, cardUsage, playedByTurn, openingHand, prizeRace, firstDown, earlyKnockOuts, catalogue } from "../../site/js/insights.js";

// A made-up saved game. played: [[card, my turn]]; setup: my Pokémon put down at setup; prize: who took the first
// Prize card; early: an opponent's Pokémon I Knock Out on my turn 1; oppHas: their Pokémon in play; down: my first Pokémon Knocked Out.
function mk(result, { played = [], opening = [], mull = 0, oppMull = 0, setup = 1, prize = null, early = null, oppHas = [], down = null, deck = "drag" } = {}) {
  const ev = [];
  for (let i = 0; i < setup; i++) ev.push({ type: "play", side: "me", turn: 0, sideTurn: 0, turnSide: null, card: { name: "Duskull" }, to: "Bench" });
  for (const n of oppHas) ev.push({ type: "play", side: "opp", turn: 0, sideTurn: 0, turnSide: null, card: { name: n }, to: "Bench" });
  for (const [name, t] of played) ev.push({ type: "play", side: "me", turn: t * 2, sideTurn: t, turnSide: "me", card: { name } });
  if (early) ev.push({ type: "ko", side: "opp", turn: 2, sideTurn: 1, turnSide: "me", pokemon: { name: early } });
  if (down) ev.push({ type: "ko", side: "me", turn: 3, sideTurn: 2, turnSide: "opp", pokemon: { name: down } });
  if (prize) ev.push({ type: "prize", side: prize, count: 1, turn: 3, sideTurn: 2, turnSide: prize });
  return { oppDeck: deck, oppDeckSet: null, game: { result, wentFirst: true, reason: "prizes", turns: 8,
    mulligans: { me: mull, opp: oppMull }, openingHand: opening.map(name => ({ name })), events: ev } };
}
const many = (n, wonCount, opts) => Array.from({ length: n }, (_, i) => mk(i < wonCount ? "win" : "loss", opts));

test("a comparison needs 10 games in each group", () => {
  const games = [...many(9, 9, { mull: 1 }), ...many(15, 5)];
  assert.equal(compare(games, "x", g => g.game.mulligans.me > 0), null);
  const r = compare([...many(10, 8, { mull: 1 }), ...many(10, 4)], "x", g => g.game.mulligans.me > 0);
  assert.deepEqual([r.yes.k, r.yes.n, r.no.k, r.no.n], [8, 10, 4, 10]);
  assert.ok(Math.abs(r.gap - 0.4) < 1e-9);
});

test("item 4: a card that shows up but is not played is rare; one never played in the last games is flagged", () => {
  const games = [mk("win", { opening: ["Lillie's Clefairy ex"], played: [["Lillie's Clefairy ex", 2]] }),
    ...Array.from({ length: 9 }, () => mk("loss", { opening: ["Lillie's Clefairy ex"], played: [["Ultra Ball", 1]] }))];
  const [clef, ball, tool] = cardUsage(games, [{ name: "Lillies Clefairy ex", count: 1 }, { name: "Ultra Ball", count: 4 }, { name: "Hero's Cape", count: 1 }]);
  assert.deepEqual([clef.shown, clef.played, clef.avgTurn, clef.rare, clef.never], [1, 0.1, 2, true, false]);
  assert.deepEqual([ball.played, ball.avgTurn, ball.rare], [0.9, 1, false]);
  assert.deepEqual([tool.shown, tool.played, tool.never, tool.recent], [0, 0, true, 10]);
  assert.deepEqual(cardUsage(games.slice(1), [{ name: "Ultra Ball" }]), []); // 9 games: too few
});

test("item 5: a card played by turn N against not, the turn with the largest gap", () => {
  // Rare Candy on turn 2 in 12 games (9 won), on turn 3 in 4 games (1 won), never in 10 games (3 won).
  const games = [...many(12, 9, { played: [["Rare Candy", 2]] }), ...many(4, 1, { played: [["Rare Candy", 3]] }), ...many(10, 3)];
  const [r] = playedByTurn(games, ["Rare Candy"]);
  assert.equal(r.subject, "Rare Candy played by your turn 2");
  assert.deepEqual([r.yes.k, r.yes.n, r.no.k, r.no.n], [9, 12, 4, 14]);
  assert.deepEqual(playedByTurn(games, ["Switch"]), []); // never played: one group is empty
});

test("item 6: Pokémon after setup, mulligans and a card in the opening hand", () => {
  const games = [...many(10, 7, { setup: 2, opening: ["Arven"] }), ...many(10, 2, { mull: 1, oppMull: 1 })];
  const rows = Object.fromEntries(openingHand(games).map(r => [r.subject, [r.yes.k, r.yes.n, r.no.k, r.no.n]]));
  assert.deepEqual(rows["Two or more Pokémon in play after setup"], [7, 10, 2, 10]);
  assert.deepEqual(rows["You took a mulligan"], [2, 10, 7, 10]);
  assert.deepEqual(rows["Your opponent took a mulligan"], [2, 10, 7, 10]);
  assert.deepEqual(rows["Arven in your opening hand"], [7, 10, 2, 10]);
});

test("item 7: the first Prize card, overall and per opponent deck with enough games", () => {
  const games = [...many(10, 8, { prize: "me" }), ...many(10, 3, { prize: "opp" }), ...many(6, 3, { prize: "me", deck: "gard" })];
  const rows = prizeRace(games);
  assert.deepEqual(rows.map(r => [r.deck ?? "all", r.yes.n, r.no.n]), [["all", 16, 10], ["drag", 10, 10]]);
});

test("item 8a: my Pokémon Knocked Out first, per opponent deck with 10 games", () => {
  const games = [...many(7, 3, { down: "Duskull" }), ...many(3, 1, { down: "Meowth ex" }), ...many(9, 4, { down: "Duskull", deck: "gard" })];
  assert.deepEqual(firstDown(games), [{ deck: "drag", games: 10, top: [{ name: "Duskull", count: 7 }, { name: "Meowth ex", count: 3 }] }]);
});

test("item 8b: their Pokémon Knocked Out by my turn 2, against games where they had it", () => {
  const games = [...many(10, 3, { early: "Budew", oppHas: ["Budew"] }), ...many(10, 8, { oppHas: ["Budew"] }), ...many(5, 5)];
  const [r] = earlyKnockOuts(games);
  assert.equal(r.subject, "You Knocked Out their Budew by your turn 2");
  assert.deepEqual([r.yes.k, r.yes.n, r.no.k, r.no.n], [3, 10, 8, 10]); // the 5 games without Budew are left out
});

test("the catalogue sorts by the gap and leaves out what has too few games", () => {
  // Mulligan: 13 games (12 won) against 10 (1 won). First Prize card: 10 (9 won) against 13 (4 won). One opponent deck,
  // so no extra row per deck.
  const games = [...many(10, 9, { prize: "me", mull: 1 }), ...many(10, 1, { prize: "opp" }), ...many(3, 3, { mull: 1 })];
  const c = catalogue(games);
  assert.deepEqual(c.insights.map(r => r.subject), ["You took a mulligan", "You took the first Prize card"]);
  assert.ok(Math.abs(c.insights[0].gap) >= Math.abs(c.insights[1].gap));
  assert.deepEqual(c.usage, []); // no list picked
});
