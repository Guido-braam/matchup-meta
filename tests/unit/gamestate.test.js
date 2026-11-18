// The game-state engine: one board state per event of a parsed battle log, on the two real logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLog } from "../../site/js/battlelog.js";
import { replay } from "../../site/js/gamestate.js";

const read = f => readFileSync(new URL(`../fixtures/battle-logs/${f}`, import.meta.url), "utf8");
const G1 = parseLog(read("01-loss-prizes-no-codes.txt")).game;
const G2 = parseLog(read("02-win-concede-codes.txt")).game;
const S1 = replay(G1), S2 = replay(G2);
const at = (game, states, pred) => states[game.events.findIndex(pred)];
const inPlay = side => [side.active, ...side.bench].filter(Boolean);

test("one state per event, each with the event's turn", () => {
  assert.equal(S1.length, G1.events.length);
  assert.ok(S1.every((s, i) => s.turn === G1.events[i].turn));
});

test("Prize cards left at the end match the log", () => {
  const end = S1[S1.length - 1];
  assert.deepEqual([end.me.prizes, end.opp.prizes], [3, 0]);
  const end2 = S2[S2.length - 1];
  assert.deepEqual([end2.me.prizes, end2.opp.prizes], [4, 6]);
});

test("the board follows plays, evolutions, Energy and Knock Outs", () => {
  // Sample 01, the opponent's second turn ends with Budew Active and two Drakloak on the Bench, one with Fire Energy.
  const s = at(G1, S1, e => e.type === "attack" && e.attack === "Itchy Pollen");
  assert.equal(s.opp.active.name, "Budew");
  const drakloak = s.opp.bench.filter(m => m.name === "Drakloak");
  assert.equal(drakloak.length, 2);
  assert.deepEqual(drakloak.flatMap(m => m.energy), ["Basic Fire Energy"]);
  assert.deepEqual(drakloak[0].stack, ["Dreepy"]);
  assert.equal(s.me.active.damage, 10); // Itchy Pollen on my Duskull
  // I had two Talonflame ex; the Active one is Knocked Out at the end, the other stays on the Bench.
  const i = G1.events.findIndex(e => e.type === "ko" && e.pokemon.name === "Talonflame ex");
  const talon = s => inPlay(s.me).filter(m => m.name === "Talonflame ex");
  assert.equal(talon(S1[i - 1]).length, 2);
  assert.equal(S1[i - 1].me.active.name, "Talonflame ex");
  assert.equal(talon(S1[i]).length, 1);
  assert.equal(S1[i].me.active, null);
});

test("placed damage lands on the Pokémon's real owner, not the one the log names", () => {
  // "Hawk'eye42 put 5 damage counters on Hawk'eye42's Budew": Budew is the opponent's.
  const s = at(G1, S1, e => e.type === "counters" && e.target.pokemon.name === "Budew");
  assert.equal(s.opp.active.name, "Budew");
  assert.equal(s.opp.active.damage, 50);
  // "Hawk'eye42 put 2 damage counters on riku_land's Duskull" (Risky Ruins): both Duskull are mine.
  const i = G2.events.findIndex(e => e.type === "counters" && e.target.pokemon.name === "Duskull");
  const duskull = inPlay(S2[i + 1].me).filter(m => m.name === "Duskull");
  assert.deepEqual(duskull.map(m => m.damage).sort(), [20, 20]);
  assert.ok(!inPlay(S2[i + 1].opp).some(m => m.name === "Duskull"));
});

test("a switch between two Pokémon with the same name is marked uncertain", () => {
  const i = G1.events.findIndex(e => e.type === "switch" && e.pokemon.name === e.with.pokemon.name);
  assert.ok(i > 0);
  assert.equal(S1[i].uncertain, true);
  assert.equal(S1[0].uncertain, false);
});

test("my hand is known: the opening hand, then named draws", () => {
  const open = at(G1, S1, e => e.type === "drawn" && e.cards);
  assert.deepEqual([...open.me.hand].sort(), ["Duskull", "Duskull", "Flutter Mane", "Hilda", "Hilda", "Ignition Energy", "Switch"]);
  assert.equal(open.me.handCount, 7);
  const s = at(G1, S1, e => e.type === "draw" && e.side === "me" && e.cards?.[0]?.name === "Dusknoir");
  assert.ok(s.me.hand.includes("Dusknoir"));
  assert.ok(S1.every(x => x.me.handCount >= 0 && x.opp.handCount >= 0 && x.me.deck >= 0 && x.opp.deck >= 0));
});
