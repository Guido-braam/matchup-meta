// My games: which cards each side showed, which list a game belongs to, and pasting a log into the store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLog } from "../../site/js/battlelog.js";
import { createGameStore, memoryBackend } from "../../site/js/gamestore.js";
import { newList } from "../../site/js/mylists.js";
import { cardsSeen, fitVersion, addLog, missingCards, refreshGame, exportReminder, iosSafari, linkLater } from "../../site/js/mygames.js";

const LOG2 = readFileSync(new URL("../fixtures/battle-logs/02-win-concede-codes.txt", import.meta.url), "utf8");
const LOG1 = readFileSync(new URL("../fixtures/battle-logs/01-loss-prizes-no-codes.txt", import.meta.url), "utf8");
const names = cards => cards.map(c => c.name).sort();
const G2 = parseLog(LOG2).game;

// The cards I showed in sample 02, as a list in My lists (counts do not matter for the fit).
const MINE = ["Mega Kangaskhan ex", "Talonflame ex", "Ignition Energy", "Boss's Orders", "Latias ex", "Hilda", "Dusknoir",
  "Neo Upper Energy", "Buddy-Buddy Poffin", "Black Belt's Training", "Rare Candy", "Switch", "Duskull", "Fezandipiti ex",
  "Meowth ex", "Special Red Card", "Dawn", "Flutter Mane", "Ciphermaniac's Codebreaking"];
const list = (name, cardNames, archived = false) =>
  ({ ...newList({ name, deck: null, text: "", cards: cardNames.map(n => ({ name: n, count: 1 })) }), archived });

test("cards seen per side: my opening hand and plays are mine, the opponent's are theirs", () => {
  const me = names(cardsSeen(G2, "me")), opp = names(cardsSeen(G2, "opp"));
  assert.deepEqual(me, [...MINE].sort());
  assert.ok(opp.includes("Dudunsparce ex") && opp.includes("Dreepy") && opp.includes("Munkidori"));
  assert.ok(!opp.includes("Talonflame ex"));
  // Risky Ruins puts counters on "riku_land's Duskull", but that Duskull is mine: counters lines do not count.
  assert.ok(!opp.includes("Duskull"));
});

test("the list that has every card I showed is the fit; the last used one wins a tie", () => {
  const full = list("Kanga", [...MINE, "Ultra Ball"]), other = list("Kanga 2", MINE), short = list("Old", MINE.slice(1));
  assert.equal(fitVersion([short, full], cardsSeen(G2, "me")).list.id, full.id);
  assert.equal(fitVersion([full, other], cardsSeen(G2, "me"), other.id).list.id, other.id);
  // No list has everything: no fit, but the closest one and what it misses.
  const r = fitVersion([short], cardsSeen(G2, "me"));
  assert.equal(r.list, null);
  assert.equal(r.closest.id, short.id);
  assert.deepEqual(r.missing, ["Mega Kangaskhan ex"]);
  // Archived lists are not picked.
  assert.equal(fitVersion([list("A", MINE, true)], cardsSeen(G2, "me")).list, null);
});

test("names match across spellings: Basic Energy and apostrophes", () => {
  const l = list("E", ["Psychic Energy", "Bosss Orders"]);
  assert.deepEqual(missingCards(l, [{ name: "Basic Psychic Energy" }, { name: "Boss's Orders" }, { name: "Switch" }]), ["Switch"]);
});

test("a game saved by an older parser is read again from its raw log", () => {
  const old = { id: "x", parser: 1, raw: LOG2, game: { result: "stale" } };
  const fresh = refreshGame(old, null);
  assert.equal(fresh.game.result, "win");
  assert.ok(fresh.parser > 1);
  assert.equal(refreshGame(fresh, null), fresh); // already current: the same object
  assert.equal(refreshGame({ ...old, raw: "broken" }, null).game.result, "stale"); // no longer parses: kept
});

test("pasting: a new game is saved with its list, the same log again is a duplicate, a bad paste is refused", async () => {
  const store = createGameStore(memoryBackend()), kanga = list("Kanga", MINE);
  const ctx = { store, lists: [kanga], index: null, labs: null, now: "2026-11-18T10:00:00Z" };
  const r = await addLog(LOG2, ctx);
  assert.equal(r.status, "added");
  assert.equal(r.record.listId, kanga.id);
  assert.equal(r.record.listVersion, 1);
  assert.equal(r.record.raw, LOG2);
  assert.equal(r.record.game.result, "win");
  assert.equal(r.record.added, "2026-11-18T10:00:00Z");
  assert.equal((await addLog(LOG2.replace(/\n/g, "\n\n"), ctx)).status, "duplicate");
  const bad = await addLog("hello", ctx);
  assert.equal(bad.status, "invalid");
  assert.deepEqual(bad.problems, ["too short to be a battle log"]);
  // A game no list fits is still saved, without a list, so nothing is lost.
  const r1 = await addLog(LOG1, ctx);
  assert.equal(r1.status, "added");
  assert.equal(r1.record.listId, null);
  assert.equal((await store.games()).length, 2);
});

test("a game pasted before its list was saved is linked once a list fits", () => {
  const g = { id: "x", listId: null, listVersion: null, game: G2 };
  assert.equal(linkLater(g, []), g); // no lists yet: unchanged
  assert.equal(linkLater(g, [list("Old", MINE.slice(1))]), g); // misses a card: unchanged
  const kanga = list("Kanga", MINE), r = linkLater(g, [kanga]);
  assert.deepEqual([r.listId, r.listVersion], [kanga.id, 1]);
  const other = { ...g, listId: "picked" };
  assert.equal(linkLater(other, [kanga]), other); // a game with a list keeps it
  const none = { ...g, listId: "" };
  assert.equal(linkLater(none, [kanga]), none); // "no list" picked on purpose stays
});

test("a game no list fits gets the Deck list picked above the Paste button", async () => {
  const store = createGameStore(memoryBackend()), kanga = list("Kanga", MINE.slice(1));
  const r = await addLog(LOG2, { store, lists: [kanga], index: null, labs: null, lastListId: kanga.id });
  assert.equal(r.record.listId, kanga.id);
  assert.equal(r.record.listVersion, 1);
});

test("export reminder: games added after the last export, and that export over 14 days old or never", () => {
  const g = added => ({ added });
  const games = [g("2026-11-01T10:00:00Z"), g("2026-11-10T10:00:00Z"), g("2026-11-17T10:00:00Z")];
  assert.equal(exportReminder([], null, "2026-11-18T10:00:00Z"), 0); // no games: nothing to back up
  assert.equal(exportReminder(games, null, "2026-11-18T10:00:00Z"), 3); // never exported
  assert.equal(exportReminder(games, "2026-11-02T10:00:00Z", "2026-11-18T10:00:00Z"), 2); // 16 days ago, 2 games since
  assert.equal(exportReminder(games, "2026-11-05T10:00:00Z", "2026-11-18T10:00:00Z"), 0); // 13 days ago: not yet
  assert.equal(exportReminder(games, "2026-11-17T12:00:00Z", "2026-12-30T10:00:00Z"), 0); // old, but nothing new since
});

test("the home screen tip is for Safari on iPhone and iPad only, not when opened from the home screen", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
  const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
  assert.equal(iosSafari({ userAgent: IPHONE }), true);
  assert.equal(iosSafari({ userAgent: IPHONE, standalone: true }), false);
  assert.equal(iosSafari({ userAgent: IPAD, platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(iosSafari({ userAgent: IPAD, platform: "MacIntel", maxTouchPoints: 0 }), false); // a Mac
  assert.equal(iosSafari({ userAgent: IPHONE.replace("Version/19.0", "CriOS/140.0") }), false); // Chrome on iPhone
  assert.equal(iosSafari({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36" }), false);
});

test("a game keeps its version: missing cards compare with that version, not the latest", () => {
  const l = list("Kanga", MINE);
  const v2 = { ...l, versions: [...l.versions, { v: 2, text: "", cards: [{ name: "Switch", count: 1 }], created: "x" }] };
  const mine = cardsSeen(G2, "me");
  assert.deepEqual(missingCards(v2, mine, 1), []);
  assert.ok(missingCards(v2, mine).length > 0); // the latest (v2) lacks most of them
  assert.ok(missingCards(v2, mine, 9).length > 0); // an unknown version counts as the latest
});
