// My lists: versions and the deck of a list, on the real labs.json and Card index the site ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deckOf, newList, saveVersion, latest } from "../../site/js/mylists.js";

const json = p => JSON.parse(readFileSync(new URL(`../../site/${p}`, import.meta.url), "utf8"));
const LABS = json("labs.json"), INDEX = json("cards/index.json");
// A deck's consensus list as My lists stores it: [{id, name, count}] (no id when the card is not in the index).
const consensus = a => a.consensus.map(([i, count]) => {
  const [name, set, num] = LABS.cards[i];
  const id = (INDEX.sets[set] || []).map(s => `${s.id}-${String(num).padStart(3, "0")}`).find(id => INDEX.cards[id]);
  return id ? { id, name, count } : { name, count };
});

test("the consensus list of Dragapult is a Dragapult deck", () => {
  const a = LABS.archetypes.find(x => x.id === "dragapult-ex");
  assert.equal(deckOf(consensus(a), LABS, INDEX)?.id, "dragapult-ex");
});

test("almost every deck's consensus list is recognised as that deck", () => {
  const withList = LABS.archetypes.filter(a => a.consensus?.length);
  const wrong = withList.filter(a => deckOf(consensus(a), LABS, INDEX)?.id !== a.id).map(a => a.id);
  assert.ok(wrong.length <= withList.length * 0.1, `not recognised: ${wrong.join(", ")}`);
});

test("a list with no known Pokémon has no deck", () => {
  assert.equal(deckOf([{ name: "Ultra Ball", count: 4 }, { name: "Not A Card", count: 4 }], LABS, INDEX), null);
});

const CARDS = [{ id: "me01-104", name: "Mega Kangaskhan ex", count: 2 }];
const EDIT = [{ id: "me01-104", name: "Mega Kangaskhan ex", count: 3 }];

test("a new list starts at v1", () => {
  const l = newList({ name: "Kangaskhan", deck: "x", text: "2 Mega Kangaskhan ex MEG 104", cards: CARDS }, "2026-11-18");
  assert.match(l.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(latest(l), { v: 1, text: "2 Mega Kangaskhan ex MEG 104", cards: CARDS, created: "2026-11-18" });
  assert.equal(l.archived, false);
});

test("editing a version without games changes it; with games it adds a version", () => {
  const l = newList({ name: "K", deck: "x", text: "a", cards: CARDS }, "d1");
  const free = saveVersion(l, { text: "b", cards: EDIT }, false, "d2");
  assert.equal(free.saved, "updated");
  assert.deepEqual(free.list.versions.map(v => v.v), [1]);
  assert.deepEqual(latest(free.list).cards, EDIT);

  const frozen = saveVersion(l, { text: "b", cards: EDIT }, true, "d2");
  assert.equal(frozen.saved, "new-version");
  assert.deepEqual(frozen.list.versions.map(v => v.v), [1, 2]);
  assert.deepEqual(frozen.list.versions[0].cards, CARDS); // the old version is untouched
  assert.equal(l.versions.length, 1); // and so is the list passed in

  // The same cards in another order or with other text are not a change.
  assert.equal(saveVersion(l, { text: "other text", cards: [...CARDS] }, true, "d2").saved, "same");
});
