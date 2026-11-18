// The game store and the one export file for Settings, My lists and games (ADR 0006), on the in-memory backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGameStore, memoryBackend, exportBackup, importBackup, logId, EXPORT_VERSION } from "../../site/js/gamestore.js";

const LOG = readFileSync(new URL("../fixtures/battle-logs/02-win-concede-codes.txt", import.meta.url), "utf8");
const SETTINGS = { localFrequencies: { "dragapult-ex": 0 }, continent: "oce" };
const LIST = { id: "list-1", name: "Kangaskhan", deck: "mega-kangaskhan", archived: false, versions: [{ v: 1, cards: [{ id: "me01-104", count: 2 }], created: "2026-11-18" }] };

test("the same log gets the same id, with or without blank lines and either apostrophe", async () => {
  const loose = LOG.split("\n").join("\n\n").replace(/'s Turn/g, "’s Turn");
  assert.equal(await logId(loose), await logId(LOG));
  assert.notEqual(await logId(LOG.replace("wins.", "wins!")), await logId(LOG));
  assert.match(await logId(LOG), /^[0-9a-f]{64}$/);
});

test("adding the same game twice keeps one", async () => {
  const store = createGameStore(memoryBackend());
  const game = { id: await logId(LOG), raw: LOG, listId: "list-1", listVersion: 1 };
  assert.equal(await store.addGame(game), "added");
  assert.equal(await store.addGame({ ...game }), "duplicate");
  assert.equal((await store.games()).length, 1);
});

test("export then import gives the same Settings, lists and games", async () => {
  const store = createGameStore(memoryBackend());
  await store.putList(LIST);
  await store.addGame({ id: await logId(LOG), raw: LOG, listId: "list-1", listVersion: 1 });
  const text = exportBackup(SETTINGS, { lists: await store.lists(), games: await store.games() });
  assert.equal(JSON.parse(text).version, EXPORT_VERSION);

  const r = importBackup(text);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.settings, SETTINGS);
  const other = createGameStore(memoryBackend());
  assert.deepEqual(await other.merge(r), { lists: 1, games: 1, duplicates: 0 });
  assert.deepEqual(await other.lists(), await store.lists());
  assert.deepEqual(await other.games(), await store.games());
  // Importing the same file again adds no games.
  assert.deepEqual(await other.merge(r), { lists: 1, games: 0, duplicates: 1 });
  assert.equal((await other.games()).length, 1);
});

test("deleting a list deletes its games and no others", async () => {
  const store = createGameStore(memoryBackend());
  await store.putList(LIST);
  await store.putList({ ...LIST, id: "list-2" });
  await store.addGame({ id: "g1", raw: "x", listId: "list-1", listVersion: 1 });
  await store.addGame({ id: "g2", raw: "y", listId: "list-2", listVersion: 1 });
  assert.equal(await store.deleteList("list-1"), true);
  assert.deepEqual((await store.lists()).map(l => l.id), ["list-2"]);
  assert.deepEqual((await store.games()).map(g => g.id), ["g2"]);
});

test("a Settings-only file from before still imports, with no lists or games", () => {
  const r = importBackup(JSON.stringify({ version: 1, continent: "eu", localFrequencies: { "gengar-ex": 5 } }));
  assert.deepEqual(r, { ok: true, settings: { localFrequencies: { "gengar-ex": 5 }, continent: "eu" }, lists: [], games: [] });
});

test("a broken file is refused with a reason", () => {
  assert.equal(importBackup("{").ok, false);
  assert.match(importBackup(JSON.stringify({ version: 3 })).error, /version/);
  const badGame = JSON.parse(exportBackup(SETTINGS, { lists: [], games: [{ id: "x" }] }));
  assert.match(importBackup(JSON.stringify(badGame)).error, /game/);
  const badLevel = { ...JSON.parse(exportBackup(SETTINGS, { lists: [], games: [] })), localFrequencies: { a: 9 } };
  assert.match(importBackup(JSON.stringify(badLevel)).error, /frequency/);
});

test("a store whose backend fails reads empty and refuses writes", async () => {
  const store = createGameStore({ getAll: () => Promise.reject(new Error("blocked")), put: () => Promise.reject(new Error("blocked")) });
  assert.deepEqual(await store.games(), []);
  assert.equal(await store.putList(LIST), false);
});
