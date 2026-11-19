// The battle log parser, on two real PTCGL logs with made-up player names (tests/fixtures/battle-logs).
// 01: a loss on prizes, card names without codes, blank lines between lines.
// 02: a win by concede, every card with its game code, no blank lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLog, cardIdFromCode } from "../../site/js/battlelog.js";

const log = f => readFileSync(new URL(`../fixtures/battle-logs/${f}`, import.meta.url), "utf8");
const LOG1 = log("01-loss-prizes-no-codes.txt"), LOG2 = log("02-win-concede-codes.txt");

// Just the cards the tests look up; me06 is missing on purpose, like in the real Card index today.
const INDEX = {
  sets: {},
  cards: {
    "me01-104": { name: "Mega Kangaskhan ex" }, "sv08.5-079": { name: "Dunsparce" },
    "sv10.5w-084": { name: "Hilda" }, "me01-127": { name: "Risky Ruins" }, "sv06.5-072": { name: "Munkidori" },
  },
};

test("sample 01: owner, turn order, result, Prize cards", () => {
  const r = parseLog(LOG1, INDEX);
  assert.equal(r.ok, true, r.problems?.join("; "));
  const g = r.game;
  assert.deepEqual(g.players, { me: "Hawk'eye42", opp: "Grat5" });
  assert.equal(g.wentFirst, false);
  assert.equal(g.result, "loss");
  assert.equal(g.reason, "prizes");
  assert.deepEqual(g.prizes, { me: 3, opp: 6 });
  assert.equal(g.turns, 9);
  assert.deepEqual(g.openingHand.map(c => c.name),
    ["Duskull", "Switch", "Ignition Energy", "Flutter Mane", "Hilda", "Hilda", "Duskull"]);
});

test("sample 01: every attack with its damage and every Knock Out, in order", () => {
  const ev = parseLog(LOG1, INDEX).game.events;
  const attacks = ev.filter(e => e.type === "attack" && e.damage != null)
    .map(e => `${e.side} ${e.pokemon.name} ${e.attack} -> ${e.target.side} ${e.target.pokemon.name} ${e.damage}`);
  assert.deepEqual(attacks, [
    "opp Budew Itchy Pollen -> me Duskull 10",
    "opp Dragapult ex Phantom Dive -> me Mega Kangaskhan ex 200",
    "me Talonflame ex Talon Hunt -> opp Dragapult ex 150",
    "opp Dragapult ex Phantom Dive -> me Talonflame ex 200",
    "me Talonflame ex Talon Hunt -> opp Dragapult ex 190",
    "opp Dragapult ex Phantom Dive -> me Talonflame ex 200",
  ]);
  const kos = ev.filter(e => e.type === "ko").map(e => `${e.side} ${e.pokemon.name}`);
  assert.deepEqual(kos, ["opp Budew", "me Dusclops", "me Duskull", "opp Dragapult ex", "me Talonflame ex", "me Mega Kangaskhan ex"]);
  // Each event knows its turn; the first attack is in game turn 3, the opponent's second turn.
  const first = ev.find(e => e.type === "attack" && e.damage != null);
  assert.deepEqual([first.turn, first.turnSide, first.sideTurn], [3, "opp", 2]);
});

test("sample 02: owner, turn order, concede, card codes", () => {
  const g = parseLog(LOG2, INDEX).game;
  assert.deepEqual(g.players, { me: "Hawk'eye42", opp: "riku_land" });
  assert.equal(g.wentFirst, false);
  assert.equal(g.result, "win");
  assert.equal(g.reason, "concede");
  assert.deepEqual(g.prizes, { me: 2, opp: 0 });
  const plays = g.events.filter(e => e.type === "play").map(e => e.card);
  assert.deepEqual(plays.find(c => c.name === "Mega Kangaskhan ex"), { id: "me01-104", name: "Mega Kangaskhan ex" });
  // The ph/mph suffix is another print of the same card.
  assert.equal(g.events.flatMap(e => e.cards || []).find(c => c.name === "Dunsparce").id, "sv08.5-079");
  // me06 is not in the Card index: the card keeps its name, without an id.
  assert.deepEqual(plays.find(c => c.name === "Talonflame ex"), { name: "Talonflame ex" });
});

test("card codes map to Card index ids", () => {
  assert.equal(cardIdFromCode("me1_104", INDEX), "me01-104");
  assert.equal(cardIdFromCode("rsv10-5_84", INDEX), "sv10.5w-084");
  assert.equal(cardIdFromCode("sv8-5_79_mph", INDEX), "sv08.5-079");
  assert.equal(cardIdFromCode("me1_127_ph", INDEX), "me01-127");
  assert.equal(cardIdFromCode("me6_88", INDEX), null);
  assert.equal(cardIdFromCode("me1_104", null), null);
});

test("a log cut before the result is refused", () => {
  const cut = LOG1.slice(0, LOG1.lastIndexOf("Opponent took all"));
  const r = parseLog(cut, INDEX);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("no result line - was the whole log copied?"), r.problems.join("; "));
});

test("text that is not a battle log is refused", () => {
  const r = parseLog("4 Dreepy TWM 128\n4 Drakloak TWM 129", INDEX);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("too short to be a battle log"));
});

test("every line of both samples is recognised", () => {
  for (const l of [LOG1, LOG2]) assert.deepEqual(parseLog(l, INDEX).game.events.filter(e => e.type === "other"), []);
});

test("a log without blank lines parses the same as one with them", () => {
  const tight = LOG1.split(/\r?\n/).filter(l => l.trim()).join("\n");
  const a = parseLog(LOG1, INDEX).game, b = parseLog(tight, INDEX).game;
  assert.deepEqual(b.events.map(e => e.type), a.events.map(e => e.type));
});

test('"All Prize cards taken. X wins." is a win on Prize cards too', () => {
  const r = parseLog(LOG1.replace("Opponent took all of their Prize cards. Grat5 wins.", "All Prize cards taken. Grat5 wins."));
  assert.equal(r.ok, true);
  assert.equal(r.game.reason, "prizes");
});
