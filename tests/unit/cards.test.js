// The cards module, on a small fixture Card index in the shape of site/cards/index.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCard, cardImagePath, loadCardIndex, editDistance, cardTile } from "../../site/js/cards.js";

const INDEX = {
  sets: {
    "30C": [{ id: "30th", releaseDate: "2026-09-16" }, { id: "30th-c", releaseDate: "2026-09-16" }],
    PAL: [{ id: "sv02", releaseDate: "2023-06-09" }],
    SVI: [{ id: "sv01", releaseDate: "2023-03-31" }],
    BLK: [{ id: "sv10.5b", releaseDate: "2025-07-17" }],
    MEG: [{ id: "me01", releaseDate: "2025-09-26" }],
  },
  cards: {
    "sv01-186": { name: "Pokégear 3.0", category: "Trainer", trainerType: "Item", image: true },
    "sv02-172": { name: "Boss's Orders", category: "Trainer", trainerType: "Supporter", image: true },
    "sv10.5b-052": { name: "Crustle", category: "Pokemon", stage: "Stage1", image: true },
    "sv10.5b-084": { name: "Pokégear 3.0", category: "Trainer", trainerType: "Item", image: true },
    "me01-011": { name: "Crustle ex", category: "Pokemon", stage: "Stage1", image: false },
    "me01-114": { name: "Boss's Orders", category: "Trainer", trainerType: "Supporter", image: true },
    "30th-c-005": { name: "Pikachu", category: "Pokemon", stage: "Basic", image: true },
    "sv01-257": { name: "Basic Grass Energy", category: "Energy", energyType: "Normal", image: true },
    "me01-001": { name: "Grass Energy", category: "Energy", energyType: "Normal", image: false },
  },
};
const id = (...a) => findCard(INDEX, ...a)?.id ?? null;

test("set code + number finds the card, number padded to 3 digits", () => {
  assert.deepEqual(findCard(INDEX, "MEG", "11", "whatever"), { id: "me01-011", name: "Crustle ex", category: "Pokemon", stage: "Stage1", image: false });
  assert.equal(id("PAL", 172), "sv02-172");
});

test("30C number is found in the second set under that code", () => {
  assert.equal(id("30C", "5"), "30th-c-005");
});

test("unknown set code or number falls back to the name", () => {
  assert.equal(id("XYZ", "1", "Crustle"), "sv10.5b-052");
  assert.equal(id("MEG", "999", "Pikachu"), "30th-c-005");
});

test("name lookup ignores accents, case, apostrophes and spaces", () => {
  assert.equal(id(null, null, "Pokegear 3.0"), "sv10.5b-084");
  assert.equal(id(null, null, "  boss's   ORDERS "), "me01-114");
});

test("a close name finds the card: Boss Orders is Boss's Orders", () => {
  assert.equal(id(null, null, "Boss Orders"), "me01-114");
});

test("Crustle stays Crustle, not Crustle ex", () => {
  assert.equal(id(null, null, "Crustle"), "sv10.5b-052");
  assert.equal(id(null, null, "Crustle exx"), "me01-011");
});

test("a short name allows one typo", () => {
  assert.equal(id(null, null, "Crustl"), "sv10.5b-052");
  assert.equal(id(null, null, "PIKACHO"), "30th-c-005");
});

test("the most recent set wins among cards with that name", () => {
  assert.equal(id(null, null, "Pokégear 3.0"), "sv10.5b-084");
  assert.equal(id(null, null, "Boss's Orders"), "me01-114");
});

test("a nonsense name, or no index, is not found", () => {
  assert.equal(id(null, null, "Totally Made Up"), null);
  assert.equal(id("PAL", "TG01", "Crustle exx exx"), null);
  assert.equal(findCard(null, "PAL", "172", "Boss's Orders"), null);
});

test("edit distance counts inserts, deletes and swaps", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});

test("image path splits the id on the last dash", () => {
  assert.equal(cardImagePath("30th-c-005"), "cards/30th-c/005.webp");
  assert.equal(cardImagePath("me02.5-183"), "cards/me02.5/183.webp");
});

test("the Card index is fetched once and the promise reused", async () => {
  let calls = 0;
  const fetchFn = async url => { calls++; assert.equal(url, "cards/index.json"); return { ok: true, json: async () => INDEX }; };
  const a = loadCardIndex(fetchFn), b = loadCardIndex(fetchFn);
  assert.equal(a, b);
  assert.equal(await a, INDEX);
  assert.equal(calls, 1);
});

test("a Trainer or Energy without image borrows the image of another card with that name; a Pokémon does not", () => {
  const e = findCard(INDEX, "MEG", "1");
  assert.equal(e.id, "me01-001");
  assert.equal(e.imageId, "sv01-257");
  assert.match(cardTile(e, { name: "Grass Energy", cat: "energy", count: 4 }), /src="cards\/sv01\/257.webp"/);
  assert.equal(findCard(INDEX, "MEG", "11").image, false);
});

test("a card tile is the image with a count badge, or the placeholder without an image", () => {
  const img = cardTile(findCard(INDEX, "MEG", "114"), { name: "Boss's Orders", cat: "trainer", count: 3 });
  assert.match(img, /^<div class="ctile">/);
  assert.match(img, /<img loading="lazy" src="cards\/me01\/114.webp" alt="Boss&#39;s Orders" title="Boss&#39;s Orders"/);
  assert.match(img, /<span class="cnt">3<\/span>/);
  const noImg = cardTile(findCard(INDEX, "MEG", "11"), { name: "Crustle ex", count: 1, note: "MEG 11" });
  assert.match(noImg, /^<div class="ctile ph">/);
  assert.doesNotMatch(noImg, /<img/);
  assert.match(noImg, /<span class="ft">MEG 11<\/span>/);
  const unknown = cardTile(null, { name: "<Mystery>", note: "card not recognized" });
  assert.match(unknown, /&lt;Mystery&gt;/);
  assert.match(unknown, /card not recognized/);
  assert.doesNotMatch(unknown, /class="cnt"/);
});
