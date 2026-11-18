// Game store: My lists and games in the visitor's browser (IndexedDB, ADR 0006), and the one export file
// that carries Settings, My lists and games together. Like storage.js, a blocked or missing store never
// breaks the site: reads give [] and writes give false.
import { importSettings, SETTINGS_VERSION } from "./calc.js";

// The export file; version 1 was Settings only and still imports.
export const EXPORT_VERSION = 2;
const DB_NAME = "matchup-meta", DB_VERSION = 1, STORES = ["lists", "games"];

// The id of a game: SHA-256 of its log, read the way the parser reads it (either apostrophe, no blank lines,
// no spaces at the line ends), so the same game pasted twice gets the same id.
export async function logId(raw) {
  const text = String(raw).normalize("NFC").replace(/’/g, "'").split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean).join("\n");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Backend: getAll(store) -> [records], put(store, record). Records are keyed by their id.
export function memoryBackend() {
  const data = Object.fromEntries(STORES.map(s => [s, new Map()]));
  return {
    getAll: async s => [...data[s].values()].map(r => structuredClone(r)),
    put: async (s, r) => { data[s].set(r.id, structuredClone(r)); },
  };
}

export function indexedDbBackend(idb = globalThis.indexedDB) {
  let db;
  const open = () => db ??= new Promise((ok, fail) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => STORES.forEach(s => req.result.createObjectStore(s, { keyPath: "id" }));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => { db = null; fail(req.error); };
  });
  const run = async (s, mode, fn) => {
    const tx = (await open()).transaction(s, mode), req = fn(tx.objectStore(s));
    return new Promise((ok, fail) => { tx.oncomplete = () => ok(req.result); tx.onerror = tx.onabort = () => fail(tx.error); });
  };
  return { getAll: s => run(s, "readonly", st => st.getAll()), put: (s, r) => run(s, "readwrite", st => st.put(r)) };
}

export function createGameStore(backend = indexedDbBackend()) {
  const all = s => Promise.resolve().then(() => backend.getAll(s)).catch(() => []);
  const put = (s, r) => Promise.resolve().then(() => backend.put(s, r)).then(() => true, () => false);
  const store = {
    lists: () => all("lists"),
    games: () => all("games"),
    putList: list => put("lists", list),
    // "added", "duplicate" (a game with this id is already saved) or "failed".
    async addGame(game) {
      if ((await store.games()).some(g => g.id === game.id)) return "duplicate";
      return (await put("games", game)) ? "added" : "failed";
    },
    // An imported file: lists by id (the file wins), games only when not saved yet.
    async merge({ lists = [], games = [] }) {
      let nl = 0, ng = 0, dup = 0;
      for (const l of lists) if (await store.putList(l)) nl++;
      const have = new Set((await store.games()).map(g => g.id));
      for (const g of games) {
        if (have.has(g.id)) { dup++; continue; }
        if (await put("games", g)) { ng++; have.add(g.id); }
      }
      return { lists: nl, games: ng, duplicates: dup };
    },
  };
  return store;
}

export const exportBackup = ({ localFrequencies, continent }, { lists = [], games = [] }) =>
  JSON.stringify({ version: EXPORT_VERSION, continent, localFrequencies, lists, games }, null, 2);

const isObj = o => o && typeof o === "object" && !Array.isArray(o);

// {ok: true, settings, lists, games} or {ok: false, error}. Everything is checked before anything changes.
export function importBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { ok: false, error: "This file is not a Matchup Meta file (no valid JSON)." }; }
  if (!isObj(o)) return { ok: false, error: "This file is not a Matchup Meta file." };
  if (o.version === SETTINGS_VERSION) {
    const r = importSettings(text);
    return r.ok ? { ...r, lists: [], games: [] } : r;
  }
  if (o.version !== EXPORT_VERSION) return { ok: false, error: `Unsupported file version: ${JSON.stringify(o.version)} (expected ${EXPORT_VERSION}).` };
  const s = importSettings(JSON.stringify({ version: SETTINGS_VERSION, continent: o.continent, localFrequencies: o.localFrequencies }));
  if (!s.ok) return s;
  const { lists = [], games = [] } = o;
  if (!Array.isArray(lists) || !lists.every(l => isObj(l) && typeof l.id === "string" && Array.isArray(l.versions)))
    return { ok: false, error: "A list in My lists is damaged (no id or versions)." };
  if (!Array.isArray(games) || !games.every(g => isObj(g) && typeof g.id === "string" && typeof g.raw === "string"))
    return { ok: false, error: "A saved game is damaged (no id or battle log)." };
  return { ok: true, settings: s.settings, lists, games };
}
