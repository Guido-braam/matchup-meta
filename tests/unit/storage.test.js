// The storage module, on a stand-in for the browser's localStorage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStorage } from "../../site/js/storage.js";

// The part of the Web Storage interface the module uses, kept in a Map.
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    raw: k => m.get(k),
  };
}
const SETTINGS = "matchup-meta-settings";

test("Settings are stored under a versioned shape", () => {
  const ls = memoryStorage();
  const ok = createStorage(() => ls).saveSettings({ localFrequencies: { "dragapult-ex": 2, "crustle-dri": 0 }, continent: "eu" });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(ls.raw(SETTINGS)), { version: 1, localFrequencies: { "dragapult-ex": 2, "crustle-dri": 0 }, continent: "eu" });
});

test("saved Settings load back the same", () => {
  const ls = memoryStorage();
  createStorage(() => ls).saveSettings({ localFrequencies: { "gengar-ex": 5 }, continent: "oce" });
  assert.deepEqual(createStorage(() => ls).loadSettings(), { localFrequencies: { "gengar-ex": 5 }, continent: "oce" });
});

test("Settings saved before the continent existed load as Worldwide", () => {
  const stored = { version: 1, localFrequencies: { "gengar-ex": 5 } };
  const s = createStorage(() => memoryStorage({ [SETTINGS]: JSON.stringify(stored) }));
  assert.deepEqual(s.loadSettings(), { localFrequencies: { "gengar-ex": 5 }, continent: "worldwide" });
});

test("an unknown continent loads and saves as Worldwide", () => {
  const stored = { version: 1, localFrequencies: {}, continent: "asia" };
  assert.deepEqual(createStorage(() => memoryStorage({ [SETTINGS]: JSON.stringify(stored) })).loadSettings(),
    { localFrequencies: {}, continent: "worldwide" });
  const ls = memoryStorage();
  createStorage(() => ls).saveSettings({ localFrequencies: {}, continent: 3 });
  assert.equal(JSON.parse(ls.raw(SETTINGS)).continent, "worldwide");
});

test("without stored Settings every deck keeps its default and the continent is Worldwide", () => {
  assert.deepEqual(createStorage(() => memoryStorage()).loadSettings(), { localFrequencies: {}, continent: "worldwide" });
});

test("unreadable or unknown stored Settings fall back to defaults", () => {
  for (const stored of ["{not json", "null", "[]", '{"version":2,"localFrequencies":{"dragapult-ex":2}}', '{"localFrequencies":{"dragapult-ex":2}}']) {
    const s = createStorage(() => memoryStorage({ [SETTINGS]: stored }));
    assert.deepEqual(s.loadSettings(), { localFrequencies: {}, continent: "worldwide" }, stored);
  }
});

test("only valid frequency levels are loaded", () => {
  const stored = { version: 1, localFrequencies: { a: 0, b: 5, c: 6, d: -1, e: 2.5, f: "3", g: null } };
  const s = createStorage(() => memoryStorage({ [SETTINGS]: JSON.stringify(stored) }));
  assert.deepEqual(s.loadSettings(), { localFrequencies: { a: 0, b: 5 }, continent: "worldwide" });
});

test("storage that is blocked or throws gives defaults, and saving reports failure", () => {
  const boom = () => { throw new Error("SecurityError"); };
  const backends = {
    blocked: boom,                                                    // reading localStorage itself throws
    missing: () => undefined,                                         // no localStorage at all
    throwing: () => ({ getItem: boom, setItem: boom, removeItem: boom }), // e.g. quota exceeded
  };
  for (const [name, backend] of Object.entries(backends)) {
    const s = createStorage(backend);
    assert.deepEqual(s.loadSettings(), { localFrequencies: {}, continent: "worldwide" }, name);
    assert.equal(s.saveSettings({ localFrequencies: { a: 1 } }), false, name);
  }
});

// The API key and Advice history live outside Settings, so an export of Settings never carries them (ADR 0002).
const API_KEY = "matchup-meta-api-key", ADVICE = "matchup-meta-advice";

test("the API key is stored on its own, outside Settings, and removed in one call", () => {
  const ls = memoryStorage();
  const s = createStorage(() => ls);
  s.saveSettings({ localFrequencies: { "dragapult-ex": 2 } });
  assert.equal(s.loadApiKey(), null);

  assert.equal(s.saveApiKey("  sk-ant-test-key \n"), true);
  assert.equal(createStorage(() => ls).loadApiKey(), "sk-ant-test-key");
  assert.equal(JSON.parse(ls.raw(API_KEY)), "sk-ant-test-key");
  assert.deepEqual(JSON.parse(ls.raw(SETTINGS)), { version: 1, localFrequencies: { "dragapult-ex": 2 }, continent: "worldwide" });

  assert.equal(s.removeApiKey(), true);
  assert.equal(ls.raw(API_KEY), undefined);
  assert.equal(s.loadApiKey(), null);
});

// One saved Advice: the structured answer plus when and with what it was made.
const advice = n => ({ result: { summary: `Advice ${n}`, picks: [] }, createdAt: `2026-11-0${n % 10}T10:00:00.000Z`, context: "", dataGenerated: "2026-10-16", labsGenerated: null });

test("Advice history loads back newest first, outside Settings, and keeps the last 10", () => {
  const ls = memoryStorage();
  const s = createStorage(() => ls);
  assert.deepEqual(s.loadAdviceHistory(), []);

  const twelve = Array.from({ length: 12 }, (_, n) => advice(n));
  assert.equal(s.saveAdviceHistory(twelve), true);
  assert.deepEqual(createStorage(() => ls).loadAdviceHistory(), twelve.slice(0, 10));
  assert.equal(JSON.parse(ls.raw(ADVICE)).length, 10);
  assert.deepEqual(s.loadSettings(), { localFrequencies: {}, continent: "worldwide" });
});

test("unreadable Advice history entries are left out", () => {
  const stored = [advice(1), null, "text", { result: "not an object", createdAt: "2026-11-01" }, { result: {} }, advice(2)];
  const s = createStorage(() => memoryStorage({ [ADVICE]: JSON.stringify(stored) }));
  assert.deepEqual(s.loadAdviceHistory(), [advice(1), advice(2)]);
  assert.deepEqual(createStorage(() => memoryStorage({ [ADVICE]: '{"not":"a list"}' })).loadAdviceHistory(), []);
});

test("with storage blocked there is no API key or Advice history, and saving them reports failure", () => {
  const s = createStorage(() => { throw new Error("SecurityError"); });
  assert.equal(s.loadApiKey(), null);
  assert.equal(s.saveApiKey("sk-ant-test-key"), false);
  assert.deepEqual(s.loadAdviceHistory(), []);
  assert.equal(s.saveAdviceHistory([advice(1)]), false);
});

// Deck chat history: per deck the last 30 messages, under its own key, outside Settings.
const DECK_CHAT = "matchup-meta-deck-chat";
const turns = n => Array.from({ length: n }, (_, k) => k % 2 ? { role: "assistant", content: `Answer ${k}`, ...(k === 1 && { cut: true }) } : { role: "user", content: `Question ${k}` });

test("Deck chat history loads back per deck, outside Settings, and keeps the last 30 messages", () => {
  const ls = memoryStorage();
  const s = createStorage(() => ls);
  assert.deepEqual(s.loadDeckChats(), {});

  assert.equal(s.saveDeckChats({ "dragapult-ex": turns(34), "crustle-dri": turns(2), "gengar-ex": [] }), true);
  assert.deepEqual(createStorage(() => ls).loadDeckChats(), { "dragapult-ex": turns(34).slice(-30), "crustle-dri": turns(2) });
  assert.deepEqual(s.loadSettings(), { localFrequencies: {}, continent: "worldwide" });
  assert.equal(ls.raw(SETTINGS), undefined);
});

test("unreadable Deck chat messages are left out, and blocked storage gives no history", () => {
  const stored = { "dragapult-ex": [turns(1)[0], null, { role: "system", content: "x" }, { role: "user", content: 3 }], other: "text" };
  assert.deepEqual(createStorage(() => memoryStorage({ [DECK_CHAT]: JSON.stringify(stored) })).loadDeckChats(), { "dragapult-ex": turns(1) });
  assert.deepEqual(createStorage(() => memoryStorage({ [DECK_CHAT]: "[1,2]" })).loadDeckChats(), {});
  const blocked = createStorage(() => { throw new Error("SecurityError"); });
  assert.deepEqual(blocked.loadDeckChats(), {});
  assert.equal(blocked.saveDeckChats({ "dragapult-ex": turns(2) }), false);
});
