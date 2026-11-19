// Deck Lab's rows: the shared line parser and serialize, on a small fixture Card index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, rowsFrom, serialize, canAdd, deckWarnings, bump, searchCards, printOf, addRow } from "../../site/js/decklab.js";

const INDEX = {
  sets: { ASC: [{ id: "me02", releaseDate: "2026-01-30" }], MEG: [{ id: "me01", releaseDate: "2025-09-26" }], PRSW: [] },
  cards: {
    "me02-158": { name: "Dreepy", category: "Pokemon", stage: "Basic", image: true },
    "me01-114": { name: "Boss's Orders", category: "Trainer", trainerType: "Supporter", image: true },
    "me01-200": { name: "Darkness Energy", category: "Energy", energyType: "Normal", image: true },
    "sve-015": { name: "Basic Darkness Energy", category: "Energy", energyType: "Normal", image: true }, // older name of the same card
  },
};

test("parseLine reads count, name, set and number, and skips headings and totals", () => {
  assert.deepEqual(parseLine("4 Dreepy ASC 158"), { count: 4, name: "Dreepy", set: "ASC", num: "158" });
  assert.deepEqual(parseLine(" 2x Basic {D} Energy "), { count: 2, name: "Basic {D} Energy", set: "", num: "" });
  assert.deepEqual(parseLine("1 Boss's Orders PR-SW 251"), { count: 1, name: "Boss's Orders", set: "PR-SW", num: "251" });
  for (const l of ["Pokémon: 20", "Trainer: 32", "Energy: 8", "Total Cards: 60", "", "Dreepy"]) assert.equal(parseLine(l), null);
});

const LIST = `Pokémon: 5
4 Dreepy ASC 158
1 Dudunsparce TEF 129

Trainer: 3
2 Boss's Orders MEG 114
1 Boss's Orders PR-SW 251

Energy: 2
2 Basic {D} Energy

Total Cards: 10`;

test("rowsFrom keeps every line as it came in, unknown lines in their section", () => {
  const rows = rowsFrom(LIST, INDEX);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[1], { count: 1, name: "Dudunsparce", set: "TEF", num: "129", cat: "pokemon" }); // not in the index
  assert.deepEqual(rows.map(r => r.cat), ["pokemon", "pokemon", "trainer", "trainer", "energy"]);
});

test("serialize gives the list back as it came in: two prints, unknown lines, energy symbols", () => {
  assert.equal(serialize(rowsFrom(LIST, INDEX)), LIST);
});

test("serialize puts a line in the section of its card, also when it came in under none", () => {
  const rows = rowsFrom("4 Dreepy ASC 158\n2 Boss's Orders\n3 Mystery Card", INDEX);
  assert.equal(serialize(rows), "Pokémon: 4\n4 Dreepy ASC 158\n\nTrainer: 2\n2 Boss's Orders\n\n3 Mystery Card\n\nTotal Cards: 9");
  assert.equal(serialize([]), "");
});

test("without a Card index every line is kept under its own heading", () => {
  assert.equal(serialize(rowsFrom(LIST, null)), LIST);
});

// ---------- Deck rules and − / + ----------
const entry = (o) => ({ cat: "trainer", sub: "item", count: 1, ace: false, ...o });

test("canAdd: up to 4 per name, basic Energy without a limit, nothing for a line Deck Lab does not know", () => {
  assert.equal(canAdd(entry({ count: 3 })), true);
  assert.equal(canAdd(entry({ count: 4 })), false);
  assert.equal(canAdd(entry({ count: 5 })), false); // an import with 5 copies loads, but + stays off
  assert.equal(canAdd(entry({ cat: "energy", sub: "basic", count: 12 })), true);
  assert.equal(canAdd(entry({ cat: "energy", sub: "special", count: 4 })), false);
  assert.equal(canAdd(entry({ cat: null, sub: null, count: 1 })), false);
});

test("deckWarnings: a total other than 60 and more than one ACE SPEC, without blocking", () => {
  const sixty = [entry({ count: 56 }), entry({ count: 4 })];
  assert.deepEqual(deckWarnings(sixty), []);
  assert.deepEqual(deckWarnings([...sixty, entry({ ace: true })]), ["61 / 60 cards. A deck needs exactly 60."]);
  assert.deepEqual(deckWarnings([entry({ count: 58 }), entry({ ace: true }), entry({ ace: true })]),
    ["2 ACE SPEC cards. A deck may have only 1."]);
});

test("bump changes the first row of a card, over its prints, and drops a row at 0", () => {
  const rows = rowsFrom(LIST, INDEX), boss = "trainer|boss's orders";
  const plus = bump(rows, INDEX, boss, 1);
  assert.deepEqual(plus.filter(r => r.name === "Boss's Orders").map(r => r.count), [3, 1]);
  assert.equal(rows[2].count, 2); // the old rows stay as they were
  let r = rows;
  r = bump(r, INDEX, boss, -1); r = bump(r, INDEX, boss, -1);
  assert.deepEqual(r.filter(x => x.name === "Boss's Orders").map(x => `${x.count} ${x.set}`), ["1 PR-SW"]);
  r = bump(r, INDEX, boss, -1);
  assert.equal(r.some(x => x.name === "Boss's Orders"), false);
  // A line Deck Lab does not know goes by its own name.
  assert.equal(bump(rows, INDEX, "null|dudunsparce", -1).some(x => x.name === "Dudunsparce"), false);
  assert.equal(bump(rows, INDEX, "pokemon|nothing", 1), rows);
});

// ---------- Add a card ----------
const SEARCH = [
  { id: "me01-114", name: "Boss's Orders", category: "Trainer", trainerType: "Supporter", text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot." },
  { id: "x-1", name: "Switch", category: "Trainer", trainerType: "Item", text: "Switch your Active Pokémon with 1 of your Benched Pokémon." },
  { id: "x-2", name: "Pokégear 3.0", category: "Trainer", trainerType: "Item", text: "Look at the top 7 cards of your deck." },
  { id: "me02-158", name: "Dreepy", category: "Pokemon", stage: "Basic", types: ["Dragon"], hp: 70, text: "Petty Grudge [P] 10" },
  { id: "x-3", name: "Dreepy", category: "Pokemon", stage: "Basic", types: ["Dragon"], hp: 60, text: "Bite [R][P] 40" },
  { id: "x-4", name: "Drakloak", category: "Pokemon", stage: "Stage1", types: ["Dragon"], hp: 90, text: "Recon Directive" },
  { id: "me01-200", name: "Darkness Energy", category: "Energy", energyType: "Normal", text: "" },
];
const names = r => r.rows.map(x => x.name);

test("searchCards: one category, every word in name, text or type, without accents", () => {
  assert.deepEqual(names(searchCards(SEARCH, "trainer", "benched switch")), ["Boss's Orders", "Switch"]);
  assert.deepEqual(names(searchCards(SEARCH, "trainer", "POKEGEAR")), ["Pokégear 3.0"]);
  assert.deepEqual(names(searchCards(SEARCH, "trainer", "supporter")), ["Boss's Orders"]);
  assert.deepEqual(names(searchCards(SEARCH, "pokemon", "stage 1 dragon")), ["Drakloak"]);
  assert.deepEqual(names(searchCards(SEARCH, "pokemon", "nothing here")), []);
  assert.deepEqual(names(searchCards(SEARCH, "energy", "")), ["Darkness Energy"]);
});

test("searchCards: name matches first, then A–Z; at most 50 with the total", () => {
  // "switch" is in the name of Switch and in the text of Boss's Orders.
  assert.deepEqual(names(searchCards(SEARCH, "trainer", "switch")), ["Switch", "Boss's Orders"]);
  assert.deepEqual(names(searchCards(SEARCH, "trainer", "")), ["Boss's Orders", "Pokégear 3.0", "Switch"]);
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `y-${i}`, name: `Card ${String(i).padStart(3, "0")}`, category: "Trainer", text: "" }));
  const r = searchCards(many, "trainer", "card");
  assert.equal(r.total, 120); assert.equal(r.rows.length, 50); assert.equal(r.rows[0].name, "Card 000");
});

test("printOf: the set code of the Card's set and the number without leading zeros", () => {
  assert.deepEqual(printOf(INDEX, "me02-058"), { set: "ASC", num: "58" });
  assert.deepEqual(printOf(INDEX, "me01-000"), { set: "MEG", num: "0" });
  assert.deepEqual(printOf(INDEX, "zz-5"), { set: "", num: "" });
});

test("addRow: +1 on the entry of that card, else a new row with set and number", () => {
  const rows = rowsFrom(LIST, INDEX);
  const boss = addRow(rows, INDEX, SEARCH[0]);
  assert.deepEqual(boss.filter(r => r.name === "Boss's Orders").map(r => r.count), [3, 1]); // the first print, as +
  // "Darkness Energy" is the same card as the list's "Basic {D} Energy".
  assert.equal(addRow(rows, INDEX, SEARCH[6]).find(r => r.cat === "energy").count, 3);
  assert.equal(addRow(rows, INDEX, SEARCH[3])[0].count, 5); // the same Dreepy
  // Another Dreepy (other attacks) gets its own line; so does a card that is not in the list.
  assert.deepEqual(addRow(rows, INDEX, SEARCH[4]).at(-1), { count: 1, name: "Dreepy", set: "", num: "", cat: "pokemon" });
  assert.deepEqual(addRow([], INDEX, SEARCH[1]), [{ count: 1, name: "Switch", set: "", num: "", cat: "trainer" }]);
  assert.equal(serialize(addRow([], INDEX, SEARCH[0])), "Trainer: 1\n1 Boss's Orders MEG 114\n\nTotal Cards: 1");
});
