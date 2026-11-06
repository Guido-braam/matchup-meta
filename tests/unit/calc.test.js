// The calculation module, on the committed fixture data (tests/fixtures/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeMeta, exportSettings, importSettings } from "../../site/js/calc.js";

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const DATA = fixture("data.json"), LABS = fixture("labs.json");
const deck = (meta, id) => meta.decks.find(d => d.id === id);
// The fixture Regionals with more top players counted, each on a deck outside the fixture.
const morePlayers = players => ({ ...LABS, events: LABS.events.map(e => ({ ...e, players })) });

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} is not ${expected}`);
// Recency of the fixture Regionals: Baltimore (na) 0.8312, Brisbane (oce) 1, Frankfurt (eu) 1; 6 top players each.

test("default frequency level follows the deck's share at the Regionals, not Trainerhill", () => {
  const meta = computeMeta(DATA, LABS, {});
  // Worldwide share = recency-weighted top players on the deck / recency-weighted top players counted.
  // Dragapult 2+2+2 of 6+6+6: 1/3. Crustle 0+1+0: 1 / (6 * 2.8312) = 5.887%. Other 1+0+1: 1.8312 / 16.9872 = 10.78%.
  // On Trainerhill Crustle has 2.0% (level 3) and Other 3.2% (level 4); the Regionals share wins.
  assert.equal(deck(meta, "dragapult-ex").defaultShare.source, "regionals");
  close(deck(meta, "dragapult-ex").defaultShare.share, 1 / 3);
  close(deck(meta, "crustle-dri").defaultShare.share, 0.058868);
  close(deck(meta, "other").defaultShare.share, 0.107799);
  assert.equal(deck(meta, "dragapult-ex").defaultLevel, 5);
  assert.equal(deck(meta, "crustle-dri").defaultLevel, 5);
  assert.equal(deck(meta, "other").defaultLevel, 5);
});

test("share is computed from the per-Regional counts, not the precomputed share", () => {
  const labs = { ...LABS, archetypes: LABS.archetypes.map(a => ({ ...a, share: 0.9 })) };
  close(deck(computeMeta(DATA, labs, {}), "crustle-dri").defaultShare.share, 0.058868);
});

test("a lower share at the Regionals gives a lower default level", () => {
  // The fixture with 16 top players counted per Regional instead of 6 (10 more on decks outside the cut):
  // Crustle 1 / (16 * 2.8312) = 2.21% (level 3), Festival Lead 1 / 45.299 = 2.21%, Dragapult 6 / 45.299 = 12.5%.
  const meta = computeMeta(DATA, morePlayers(16), {});
  assert.equal(deck(meta, "crustle-dri").defaultLevel, 3);
  assert.equal(deck(meta, "festival-lead").defaultLevel, 3);
  assert.equal(deck(meta, "dragapult-ex").defaultLevel, 5);
});

test("Regionals on the chosen continent count 1.5 times", () => {
  // Oceania: Brisbane counts 1.5, so 6 * (0.8312 + 1.5 + 1) = 19.987 top players counted.
  const meta = computeMeta(DATA, LABS, { continent: "oce" });
  close(deck(meta, "crustle-dri").defaultShare.share, 1.5 / 19.9872);   // played in Brisbane only
  close(deck(meta, "festival-lead").defaultShare.share, 1 / 19.9872);   // played in Frankfurt only
  close(deck(meta, "other").defaultShare.share, 1.8312 / 19.9872);      // Baltimore and Frankfurt
  assert.deepEqual(meta.continent, { chosen: "oce", used: "oce" });
});

test("Worldwide counts every Regional the same, and is the default", () => {
  const worldwide = computeMeta(DATA, LABS, { continent: "worldwide" });
  close(deck(worldwide, "crustle-dri").defaultShare.share, 1 / 16.9872);
  assert.deepEqual(worldwide.continent, { chosen: "worldwide", used: "worldwide" });
  assert.deepEqual(computeMeta(DATA, LABS, {}).continent, { chosen: "worldwide", used: "worldwide" });
});

test("a continent without Regionals in the season uses Worldwide", () => {
  // The fixture has no Regional in Latin America.
  const meta = computeMeta(DATA, LABS, { continent: "latam" });
  assert.deepEqual(meta.continent, { chosen: "latam", used: "worldwide" });
  close(deck(meta, "crustle-dri").defaultShare.share, 1 / 16.9872);
});

test("the chosen continent can change a default level; local frequencies stay", () => {
  // With 16 top players per Regional, Crustle (Brisbane only) is 2.21% Worldwide (Regularly)
  // and 1.5 / (16 * 3.3312) = 2.81% for Oceania (Often).
  const labs = morePlayers(16), settings = { localFrequencies: { "dragapult-ex": 1 } };
  const worldwide = computeMeta(DATA, labs, settings), oceania = computeMeta(DATA, labs, { ...settings, continent: "oce" });
  assert.equal(deck(worldwide, "crustle-dri").defaultLevel, 3);
  assert.equal(deck(oceania, "crustle-dri").defaultLevel, 4);
  assert.equal(deck(oceania, "crustle-dri").level, 4);
  assert.equal(deck(oceania, "dragapult-ex").level, 1);
});

test("a deck not played at the Regionals falls back to its Trainerhill share", () => {
  const gengar = deck(computeMeta(DATA, LABS, {}), "gengar-ex");
  assert.deepEqual(gengar.defaultShare, { share: 0.001608, source: "trainerhill" });
  assert.equal(gengar.defaultLevel, 1);
});

test("without labs.json every deck falls back to its Trainerhill share", () => {
  const meta = computeMeta(DATA, null, {});
  // Trainerhill: Dragapult 11.5%, Basic Box 4.0%, Crustle 2.0%, Other 3.2%.
  assert.deepEqual(deck(meta, "dragapult-ex").defaultShare, { share: 0.115196, source: "trainerhill" });
  assert.equal(deck(meta, "basic-box-m").defaultLevel, 4);
  assert.equal(deck(meta, "crustle-dri").defaultLevel, 3);
  assert.equal(deck(meta, "other").defaultLevel, 4);
});

test("default level thresholds are 5%, 2.5%, 1%, 0.4% and 0.1%", () => {
  const cases = [
    [0.05, 5], [0.0499, 4], [0.025, 4], [0.0249, 3], [0.01, 3], [0.0099, 2],
    [0.004, 2], [0.0039, 1], [0.001, 1], [0.00099, 0], [0, 0],
  ];
  const archetypes = cases.map(([share], k) => ({ id: `d${k}`, name: `Deck ${k}`, share, sprites: [] }));
  const data = { ...DATA, archetypes, matchups: [] };
  const expected = cases.map(([, lv]) => lv);
  // The same thresholds for a Trainerhill share and for a Regionals share.
  assert.deepEqual(computeMeta(data, null, {}).decks.map(d => d.defaultLevel), expected);
  // One Regional of 100,000 top players, so each share is a whole number of players.
  const labs = {
    ...LABS,
    events: [{ ...LABS.events[0], players: 100000, recency: 1 }],
    archetypes: archetypes.map(a => ({ id: a.id, counts: [Math.round(a.share * 100000)] })),
  };
  const meta = computeMeta({ ...data, archetypes: archetypes.map(a => ({ ...a, share: 0.5 })) }, labs, {});
  assert.deepEqual(meta.decks.map(d => d.defaultLevel), expected);
});

// A My meta in which you meet only the given decks; every other deck is set to Never.
const onlyMeet = levels => ({
  localFrequencies: Object.fromEntries(DATA.archetypes.map(a => [a.id, levels[a.id] ?? 0])),
});

test("local frequencies replace the default level and set the weight", () => {
  // Dragapult (default Very often) set to Sometimes, Gengar (default Rarely) to Never; Crustle keeps its default.
  const meta = computeMeta(DATA, LABS, { localFrequencies: { "dragapult-ex": 2, "gengar-ex": 0 } });
  assert.deepEqual(
    ["dragapult-ex", "gengar-ex", "crustle-dri"].map(id => [deck(meta, id).level, deck(meta, id).weight]),
    [[2, 3], [0, 0], [5, 81]],
  );
});

test("expected winrate against one deck is that matchup, pulled towards 50% by 20 games", () => {
  // Basic Box vs Dragapult: 1174-974-257, a tie counts as a third of a win.
  // (1174 + 257/3 + 10) / (2405 + 20) = 0.523574
  const r = deck(computeMeta(DATA, LABS, onlyMeet({ "dragapult-ex": 1 })), "basic-box-m").rating;
  close(r.exp, 0.523574);
  // Favourable from 45% to 55%: (0.523574 - 0.45) / 0.10
  close(r.fav, 0.73574);
});

test("expected winrate weights each matchup by how often you meet the opponent", () => {
  // Basic Box vs Dragapult (Often, weight 27): 0.523574; vs Crustle (Rarely, weight 1): 179/437 = 0.409611.
  const r = deck(computeMeta(DATA, LABS, onlyMeet({ "dragapult-ex": 4, "crustle-dri": 1 })), "basic-box-m").rating;
  close(r.exp, (27 * 0.523574 + 0.409611) / 28);
  close(r.fav, (27 * 0.73574 + 0) / 28);
});

test("an opponent without matchup data counts as 50%", () => {
  const data = { ...DATA, matchups: DATA.matchups.filter(([i, j]) => !(i === 2 && j === 4)) };
  const r = deck(computeMeta(data, LABS, onlyMeet({ "dragapult-ex": 4, "crustle-dri": 1 })), "basic-box-m").rating;
  close(r.exp, (27 * 0.523574 + 0.5) / 28);
});

test("a deck has no expected winrate when you meet nobody it has played", () => {
  assert.equal(deck(computeMeta(DATA, LABS, onlyMeet({})), "dragapult-ex").rating, null);
  const data = { ...DATA, matchups: DATA.matchups.filter(([i, j]) => !(i === 2 && j === 0)) };
  assert.equal(deck(computeMeta(data, LABS, onlyMeet({ "dragapult-ex": 5 })), "basic-box-m").rating, null);
});

// Decks you meet, best expected winrate first ("Other" is never a deck).
const ranked = meta => meta.decks.filter(d => d.id !== "other" && d.level > 0 && d.rating)
  .sort((x, y) => y.rating.exp - x.rating.exp);

test("tiers split the ranking of decks you meet: 10% S, 15% A, 25% B, 25% C, 15% D, rest E", () => {
  const meta = computeMeta(DATA, LABS, {});
  const decks = ranked(meta);
  // Six places; the middle of each (1/12, 3/12, ... 11/12) decides its tier.
  assert.equal(decks.length, 6);
  assert.deepEqual(decks.map(d => d.tier), ["S", "A", "B", "C", "C", "E"]);
  assert.deepEqual(meta.tiers.map(t => t.tier), ["S", "A", "B", "C", "D", "E"]);
  // Each lower bound is the winrate of the lowest place in that tier; an empty tier takes the one above.
  const [s, a, b, , c, e] = decks.map(d => d.rating.exp);
  assert.deepEqual(meta.tiers.map(t => t.min), [s, a, b, c, c, -1]);
  assert.ok(e < c);
});

test("decks you never meet and Other get a tier from the same bounds", () => {
  const meta = computeMeta(DATA, LABS, { localFrequencies: { "gengar-ex": 0 } });
  const gengar = deck(meta, "gengar-ex"), other = deck(meta, "other");
  assert.equal(ranked(meta).length, 5);
  for (const d of [gengar, other]) {
    assert.ok(d.rating);
    assert.equal(d.tier, meta.tiers.find(t => d.rating.exp >= t.min).tier);
  }
});

test("decks with the same expected winrate share a place", () => {
  // A copy of Crustle, with the same matchups, is a seventh deck but adds no place.
  const n = DATA.archetypes.length, crustle = DATA.archetypes.findIndex(a => a.id === "crustle-dri");
  const copy = k => k === crustle ? n : k;
  const data = {
    ...DATA,
    archetypes: [...DATA.archetypes, { ...DATA.archetypes[crustle], id: "crustle-copy" }],
    matchups: [
      ...DATA.matchups,
      ...DATA.matchups.filter(([i, j]) => i === crustle || j === crustle).map(([i, j, ...r]) => [copy(i), copy(j), ...r]),
      ...DATA.matchups.filter(([i, j]) => i === crustle && j === crustle).map(([, , ...r]) => [crustle, n, ...r]),
      ...DATA.matchups.filter(([i, j]) => i === crustle && j === crustle).map(([, , ...r]) => [n, crustle, ...r]),
    ],
  };
  const meta = computeMeta(data, null, {});
  const decks = ranked(meta);
  assert.equal(decks.length, 7);
  assert.equal(deck(meta, "crustle-copy").rating.exp, deck(meta, "crustle-dri").rating.exp);
  // Still six places (winrates equal to 0.1 percentage point share one), so the same pattern
  // as with six decks, with both Crustles in the tier of their shared place.
  const keys = [...new Set(decks.map(d => Math.round(d.rating.exp * 1000)))];
  assert.equal(keys.length, 6);
  const PATTERN = ["S", "A", "B", "C", "C", "E"];
  assert.deepEqual(decks.map(d => d.tier), decks.map(d => PATTERN[keys.indexOf(Math.round(d.rating.exp * 1000))]));
});

test("a deck without an expected winrate has no tier", () => {
  assert.equal(deck(computeMeta(DATA, LABS, onlyMeet({})), "dragapult-ex").tier, null);
});

// Export and import of Settings: a JSON file with a version number; an invalid file is rejected whole.
test("exported Settings import back exactly the same", () => {
  const settings = { localFrequencies: { "dragapult-ex": 0, "crustle-dri": 3 }, continent: "oce" };
  assert.deepEqual(importSettings(exportSettings(settings)), { ok: true, settings });
});

test("an export holds only the version, the continent and the local frequencies", () => {
  const file = JSON.parse(exportSettings({ localFrequencies: { "gengar-ex": 5 }, continent: "eu" }));
  assert.deepEqual(file, { version: 1, continent: "eu", localFrequencies: { "gengar-ex": 5 } });
});

test("local frequencies for decks not in the data are kept, and count again when the deck returns", () => {
  const file = JSON.stringify({ version: 1, continent: "worldwide", localFrequencies: { "gone-deck": 4, "dragapult-ex": 0 } });
  const { ok, settings } = importSettings(file);
  assert.equal(ok, true);
  assert.deepEqual(settings.localFrequencies, { "gone-deck": 4, "dragapult-ex": 0 });
  assert.equal(deck(computeMeta(DATA, LABS, settings), "dragapult-ex").level, 0);
  const back = { ...DATA, archetypes: [...DATA.archetypes, { ...DATA.archetypes[0], id: "gone-deck", name: "Gone" }] };
  assert.equal(deck(computeMeta(back, LABS, settings), "gone-deck").level, 4);
});

test("a file of another version, with an unknown continent or an invalid level is rejected", () => {
  const file = o => JSON.stringify({ version: 1, continent: "eu", localFrequencies: {}, ...o });
  for (const [text, msg] of [
    [file({ version: 2 }), /version/],
    [file({ version: undefined }), /version/],
    [file({ continent: "asia" }), /continent/],
    [file({ continent: undefined }), /continent/],
    [file({ localFrequencies: { "dragapult-ex": 6 } }), /dragapult-ex/],
    [file({ localFrequencies: { "dragapult-ex": "2" } }), /dragapult-ex/],
    [file({ localFrequencies: { "dragapult-ex": 2.5 } }), /dragapult-ex/],
    [file({ localFrequencies: [] }), /frequencies/],
    ["not json", /JSON/],
    ["[]", /not a Matchup Meta/],
  ]) {
    const r = importSettings(text);
    assert.equal(r.ok, false, text);
    assert.match(r.error, msg);
    assert.equal(r.settings, undefined);
  }
});
