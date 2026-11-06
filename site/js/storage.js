// Storage module: everything the site keeps in the visitor's browser (ADR 0002), as JSON in localStorage.
// Every read and write tolerates storage being blocked, missing or throwing: reads give null or
// defaults, writes give false, so the site works with defaults for that visit.
import { CONTINENTS, LEVELS, SETTINGS_VERSION } from "./calc.js";

const SETTINGS_KEY = "matchup-meta-settings";
const IS_LEVEL = new Set(LEVELS.map(l => l.level));
const IS_CONTINENT = new Set(CONTINENTS.map(c => c.id));
const API_KEY_KEY = "matchup-meta-api-key";
const ADVICE_KEY = "matchup-meta-advice";
const ADVICE_KEEP = 10;
const DECK_CHAT_KEY = "matchup-meta-deck-chat";
const DECK_CHAT_KEEP = 30;

// Advice-geschiedenis, nieuwste eerst: alleen items met een antwoord-object en een tijdstip.
function cleanAdviceHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && typeof x === "object" && x.result && typeof x.result === "object"
    && !Array.isArray(x.result) && typeof x.createdAt === "string").slice(0, ADVICE_KEEP);
}

// Deck chat-geschiedenis: per deck-id de laatste berichten met een rol en tekst; lege gesprekken vallen weg.
function cleanDeckChats(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const out = {};
  for (const [id, list] of Object.entries(o)) {
    if (!Array.isArray(list)) continue;
    const turns = list.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
      .map(t => t.cut ? { role: t.role, content: t.content, cut: true } : { role: t.role, content: t.content }).slice(-DECK_CHAT_KEEP);
    if (turns.length) out[id] = turns;
  }
  return out;
}

// Alleen geldige frequency levels; de app bewaart alleen afwijkingen van de standaard.
function cleanFrequencies(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).filter(([, lv]) => IS_LEVEL.has(lv)));
}

// Een onbekend of ontbrekend continent (Settings van voor de continentkeuze) is Worldwide.
const cleanContinent = c => IS_CONTINENT.has(c) ? c : "worldwide";

// Opgeslagen Settings -> {localFrequencies, continent}; alles wat niet klopt wordt de standaard.
function toSettings(stored) {
  if (stored?.version !== SETTINGS_VERSION) return { localFrequencies: {}, continent: "worldwide" };
  return { localFrequencies: cleanFrequencies(stored.localFrequencies), continent: cleanContinent(stored.continent) };
}

// backend: geeft de Storage terug (localStorage); mag zelf gooien, zoals bij geblokkeerde cookies.
export function createStorage(backend = () => globalThis.localStorage) {
  const ls = () => { try { return backend() || null; } catch { return null; } };
  const read = key => {
    try { const s = ls()?.getItem(key); return s == null ? null : JSON.parse(s); } catch { return null; }
  };
  const write = (key, value) => {
    const s = ls();
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const remove = key => {
    const s = ls();
    if (!s) return false;
    try { s.removeItem(key); return true; } catch { return false; }
  };
  return {
    read, write, remove,
    loadSettings: () => toSettings(read(SETTINGS_KEY)),
    saveSettings: ({ localFrequencies, continent }) => write(SETTINGS_KEY, {
      version: SETTINGS_VERSION, localFrequencies: cleanFrequencies(localFrequencies), continent: cleanContinent(continent),
    }),
    // API key, Advice- en Deck chat-geschiedenis staan buiten Settings, zodat een export ze nooit meeneemt.
    loadApiKey: () => { const k = read(API_KEY_KEY); return typeof k === "string" && k ? k : null; },
    saveApiKey: key => write(API_KEY_KEY, String(key).trim()),
    removeApiKey: () => remove(API_KEY_KEY),
    loadAdviceHistory: () => cleanAdviceHistory(read(ADVICE_KEY)),
    saveAdviceHistory: list => write(ADVICE_KEY, cleanAdviceHistory(list)),
    loadDeckChats: () => cleanDeckChats(read(DECK_CHAT_KEY)),
    saveDeckChats: chats => write(DECK_CHAT_KEY, cleanDeckChats(chats)),
  };
}
