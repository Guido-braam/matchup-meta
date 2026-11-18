// Reconstruction of the opponent's deck, on the two real logs and the labs.json the site ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLog } from "../../site/js/battlelog.js";
import { provenCopies, reconstruct } from "../../site/js/opponent.js";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const LABS = JSON.parse(read("../../site/labs.json"));
const G1 = parseLog(read("../fixtures/battle-logs/01-loss-prizes-no-codes.txt")).game;
const G2 = parseLog(read("../fixtures/battle-logs/02-win-concede-codes.txt")).game;
const copies = (g, name) => provenCopies(g, "opp").find(c => c.name === name)?.copies ?? 0;

test("copies proven: each card put into play, played or discarded from hand is one copy", () => {
  // Sample 01: Dreepy to the Active Spot, then Poffin (Budew, Dreepy), then two more Dreepy to the Bench.
  assert.equal(copies(G1, "Dreepy"), 4);
  assert.equal(copies(G1, "Drakloak"), 3); // three evolved from Dreepy
  assert.equal(copies(G1, "Dragapult ex"), 2);
  assert.equal(copies(G1, "Buddy-Buddy Poffin"), 2);
  assert.equal(copies(G1, "Meowth ex"), 1); // discarded by Ultra Ball
  // The cards discarded from a Knocked Out Dragapult ex were already counted when they were played.
  assert.equal(copies(G1, "Basic Fire Energy"), 2);
  // Discarded from hand by Ultra Ball: one copy. Searched for and never played: still one.
  assert.equal(copies(G2, "Dragapult ex"), 1);
  assert.equal(copies(G1, "Torchic"), 1);
});

test("both samples reconstruct to a Dragapult deck, with the three closest Regional lists", () => {
  for (const g of [G1, G2]) {
    const r = reconstruct(g, LABS);
    assert.match(r.deck, /dragapult/);
    assert.equal(r.similar.length, 3);
    assert.ok(r.similar[0].score >= r.similar[1].score && r.similar[1].score >= r.similar[2].score);
    assert.ok(r.similar.every(s => s.score > 0 && s.score <= 1 && s.deckName && s.event));
    assert.equal(r.unknown, 60 - r.known);
    assert.equal(r.known, r.seen.reduce((s, c) => s + c.copies, 0));
  }
});

test("a game where the opponent showed only generic cards gets no deck", () => {
  const g = { openingHand: [], events: [
    { type: "play", side: "opp", card: { name: "Ultra Ball" } },
    { type: "play", side: "opp", card: { name: "Boss's Orders" } },
  ] };
  assert.equal(reconstruct(g, LABS).deck, null);
});
