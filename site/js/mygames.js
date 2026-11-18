// My games (spec .scratch/battle-logs): pasting a battle log, linking it to a list in My lists, the games list.
// The functions at the top are pure (tested in tests/unit/mygames.test.js); initMyGames() is the view.
import { parseLog, PARSER_VERSION } from "./battlelog.js";
import { logId } from "./gamestore.js";
import { latest } from "./mylists.js";
import { reconstruct } from "./opponent.js";

export const GAME_SCHEMA = 1;

// Card names compared loosely: case, accents, apostrophes and "Basic " before an Energy do not matter.
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`]/g, "").replace(/^basic (?=.*energy$)/, "").replace(/\s+/g, " ").trim();

// The cards a side showed in a game, once per name: [{id?, name}]. "Put N damage counters on X's Y" lines
// are left out, because the log often names the wrong owner there.
export function cardsSeen(game, side) {
  const seen = new Map();
  const add = (s, c) => { if (s === side && c?.name && !seen.has(norm(c.name))) seen.set(norm(c.name), c.id ? { id: c.id, name: c.name } : { name: c.name }); };
  if (side === "me") game.openingHand.forEach(c => add("me", c));
  for (const e of game.events) {
    if (e.type === "counters") continue;
    (e.cards || []).forEach(c => add(e.side, c));
    add(e.side, e.card);
    if (e.type === "evolve") add(e.side, e.from);
    if (["attack", "ko", "active", "retreat", "switch"].includes(e.type)) add(e.side, e.pokemon);
    if (e.type === "attack" && e.target) add(e.target.side, e.target.pokemon);
  }
  return [...seen.values()];
}

// Names of cards I showed that the list's latest version does not have.
export function missingCards(list, mine) {
  const have = new Set(latest(list).cards.map(c => norm(c.name)));
  return mine.filter(c => !have.has(norm(c.name))).map(c => c.name);
}

// The list a game was played with: a list (not archived) whose latest version has every card I showed;
// the last used list first. -> {list, version} or {list: null, closest, missing}.
export function fitVersion(lists, mine, lastListId = null) {
  const scored = lists.filter(l => !l.archived).map(l => ({ l, missing: missingCards(l, mine) }))
    .sort((a, b) => a.missing.length - b.missing.length || (b.l.id === lastListId) - (a.l.id === lastListId));
  const best = scored[0];
  if (best && !best.missing.length) return { list: best.l, version: latest(best.l).v };
  return { list: null, closest: best?.l ?? null, missing: best?.missing ?? [] };
}

// A pasted text -> {status: "added", record, fit} | {status: "duplicate", record} | {status: "invalid", problems}.
// A game no list fits is still saved (listId null), so the visitor can link it and nothing is lost.
export async function addLog(raw, { store, lists, index, labs, lastListId = null, now = new Date().toISOString() }) {
  const r = parseLog(raw, index);
  if (!r.ok) return { status: "invalid", problems: r.problems };
  const id = await logId(raw);
  const dup = (await store.games()).find(g => g.id === id);
  if (dup) return { status: "duplicate", record: dup };
  const fit = fitVersion(lists, cardsSeen(r.game, "me"), lastListId);
  const record = {
    id, schema: GAME_SCHEMA, parser: PARSER_VERSION, added: now, raw,
    listId: fit.list?.id ?? null, listVersion: fit.version ?? null,
    oppDeck: reconstruct(r.game, labs).deck, oppDeckSet: null,
    game: r.game,
  };
  const status = await store.addGame(record);
  return status === "added" ? { status, record, fit } : status === "duplicate" ? { status, record } : { status: "failed" };
}

// A game saved by an older parser, read again from its raw log; unchanged when it is current or no longer parses.
export function refreshGame(g, index) {
  if ((g.parser || 0) >= PARSER_VERSION) return g;
  const r = parseLog(g.raw, index);
  return r.ok ? { ...g, parser: PARSER_VERSION, game: r.game } : g;
}

// ---------- View ----------
// deps: {$, esc, store, storage, loadCardIndex, labs: () => labs.json or null, isCurrent: () => bool}.
const LAST_LIST_KEY = "matchup-meta-last-list", AUTO_KEY = "matchup-meta-clipboard-check";
export function initMyGames({ $, esc, store, storage, loadCardIndex, labs, isCurrent }) {
  let shown = null; // id of the game in the result card

  const deckName = id => labs()?.archetypes.find(a => a.id === id)?.name ?? "Unknown deck";
  const fmt = iso => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " +
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const listText = l => `${l.name} · v${latest(l).v}`;
  const status = html => { $("gm-result").innerHTML = html; };

  async function handle(text) {
    const [lists, index] = await Promise.all([store.lists(), loadCardIndex().catch(() => null)]);
    const r = await addLog(text, { store, lists, index, labs: labs(), lastListId: storage.read(LAST_LIST_KEY) });
    if (r.status === "invalid") return status(`<p class="gm-msg bad">Not saved: ${esc(r.problems.join("; "))}.</p>`);
    if (r.status === "failed") return status(`<p class="gm-msg bad">Not saved: this browser does not allow storage for this site.</p>`);
    if (r.record.listId) storage.write(LAST_LIST_KEY, r.record.listId);
    $("gm-manual").hidden = true; $("gm-text").value = "";
    shown = r.record.id;
    await render(r.status === "duplicate" ? `This game is already saved (added ${fmt(r.record.added)}).` : "Game saved.");
  }

  function card(g, lists, msg) {
    const G = g.game, list = lists.find(l => l.id === g.listId);
    const miss = list ? missingCards(list, cardsSeen(G, "me")) : [];
    const reason = { prizes: "on Prize cards", concede: G.result === "win" ? "opponent conceded" : "you conceded" }[G.reason] || "";
    const decks = [...(labs()?.archetypes || [])].sort((a, b) => a.name.localeCompare(b.name));
    const opp = g.oppDeckSet ?? g.oppDeck;
    const listOpts = lists.filter(l => !l.archived || l.id === g.listId)
      .map(l => `<option value="${esc(l.id)}"${l.id === g.listId ? " selected" : ""}>${esc(listText(l))}</option>`).join("");
    return `<div class="gm-card">
      ${msg ? `<p class="gm-msg">${esc(msg)}</p>` : ""}
      <div class="gm-head"><span class="pill ${G.result === "win" ? "good" : "bad"}">${G.result === "win" ? "Win" : "Loss"}</span>
        <span>${esc(reason)}</span><span>· went ${G.wentFirst ? "first" : "second"}</span><span>· ${G.turns} turns</span><span>· Prize cards ${G.prizes.me}–${G.prizes.opp}</span></div>
      <label class="gm-field">Your list<select data-gm="list"><option value="">Pick a list…</option>${listOpts}</select></label>
      ${!lists.length ? `<p class="gm-msg">Save your list in <a href="#lab">Deck Lab</a> first, then link this game to it.</p>` : ""}
      ${!list && lists.length ? `<p class="gm-msg warn">No list in My lists has every card you showed in this game. Pick the one you played.</p>` : ""}
      ${miss.length ? `<p class="gm-msg warn">Not in ${esc(list.name)}: ${esc(miss.join(", "))}. Was this game played with another list or version?</p>` : ""}
      <label class="gm-field">Opponent's deck<select data-gm="opp"><option value="">Other</option>
        ${decks.map(a => `<option value="${esc(a.id)}"${a.id === opp ? " selected" : ""}>${esc(a.name)}</option>`).join("")}
      </select></label>
      ${reconHtml(reconstruct(G, labs()))}
    </div>`;
  }

  // What the opponent showed: cards with the copies proven, how much is unknown, the closest Regional lists.
  function reconHtml(r) {
    if (!r.seen.length) return `<p class="gm-msg">The opponent showed no cards.</p>`;
    const pct = s => Math.round(s * 100) + "%";
    return `<details class="gm-recon" open><summary>Opponent's cards: ${r.known} of 60 known, ${r.unknown} unknown</summary>
      <ul class="gm-seen">${r.seen.map(c => `<li><span class="num">${c.copies}</span> ${esc(c.name)}</li>`).join("")}</ul>
      ${r.similar.length ? `<p class="gm-sub">Closest Regional lists (share of the cards seen that the list has)</p>
      <ol class="gm-similar">${r.similar.map(s => `<li><b>${esc(s.deckName)}</b> <span class="num">${pct(s.score)}</span>
        <span class="gm-meta">${s.place}${["th", "st", "nd", "rd"][s.place % 100 > 10 && s.place % 100 < 14 ? 0 : s.place % 10] || "th"} of ${s.of} · ${esc(s.event)}</span></li>`).join("")}</ol>` : ""}
    </details>`;
  }

  async function render(msg = "") {
    let [games, lists] = await Promise.all([store.games(), store.lists()]);
    if (games.some(g => (g.parser || 0) < PARSER_VERSION)) {
      const index = await loadCardIndex().catch(() => null);
      games = await Promise.all(games.map(async g => { const n = refreshGame(g, index); if (n !== g) await store.putGame(n); return n; }));
    }
    games.sort((a, b) => b.added.localeCompare(a.added));
    const g = games.find(x => x.id === shown);
    if (g) status(card(g, lists, msg)); else if (!msg) status("");
    const label = id => { const l = lists.find(x => x.id === id); return l ? listText(l) : "no list"; };
    $("gm-list").innerHTML = games.length ? games.map(x => `<button type="button" class="gm-row${x.id === shown ? " current" : ""}" data-game="${esc(x.id)}">
        <span class="pill ${x.game.result === "win" ? "good" : "bad"}">${x.game.result === "win" ? "W" : "L"}</span>
        <span class="gm-vs">vs ${esc(deckName(x.oppDeckSet ?? x.oppDeck))}</span>
        <span class="gm-meta">${x.game.wentFirst ? "1st" : "2nd"} · ${esc(label(x.listId))} · ${fmt(x.added)}</span></button>`).join("")
      : `<p class="note">No games yet. Paste your first battle log above.</p>`;
  }

  async function update(change) {
    const g = (await store.games()).find(x => x.id === shown);
    if (!g) return;
    await store.putGame({ ...g, ...change });
    await render();
  }
  $("gm-result").addEventListener("change", async e => {
    const k = e.target.dataset.gm;
    if (k === "opp") return update({ oppDeckSet: e.target.value || "" });
    if (k === "list") {
      const l = (await store.lists()).find(x => x.id === e.target.value);
      if (l) storage.write(LAST_LIST_KEY, l.id);
      return update({ listId: l?.id ?? null, listVersion: l ? latest(l).v : null });
    }
  });
  $("gm-list").addEventListener("click", e => {
    const b = e.target.closest("[data-game]");
    if (!b) return;
    shown = b.dataset.game;
    render().then(() => $("gm-result").scrollIntoView({ block: "nearest", behavior: "smooth" }));
  });

  // Paste: the button reads the clipboard (the phone asks first); refused -> a field to paste into.
  $("gm-paste").addEventListener("click", async () => {
    try { const t = await navigator.clipboard.readText(); if (t.trim()) return handle(t); } catch {}
    $("gm-manual").hidden = false; $("gm-text").focus();
    status(`<p class="gm-msg">Paste the battle log in the field below, then tap Save game.</p>`);
  });
  $("gm-add").addEventListener("click", () => { if ($("gm-text").value.trim()) handle($("gm-text").value); });
  // Ctrl+V anywhere on the tab, except in a field (the paste field keeps its own paste).
  document.addEventListener("paste", e => {
    if (!isCurrent() || e.target.closest?.("input, textarea, select")) return;
    const t = e.clipboardData?.getData("text/plain");
    if (t?.trim()) { e.preventDefault(); handle(t); }
  });

  // Chrome and Edge only: with the visitor's permission, look at the clipboard when they come back to the tab.
  const canAuto = !!navigator.permissions?.query && !!navigator.clipboard?.readText && /Chrome\//.test(navigator.userAgent);
  $("gm-auto-wrap").hidden = !canAuto;
  $("gm-auto").checked = canAuto && storage.read(AUTO_KEY) === true;
  $("gm-auto").addEventListener("change", async e => {
    storage.write(AUTO_KEY, e.target.checked);
    if (e.target.checked) try { await navigator.clipboard.readText(); } catch { e.target.checked = false; storage.write(AUTO_KEY, false); }
  });
  let found = null;
  async function checkClipboard() {
    if (!$("gm-auto").checked || !isCurrent() || document.visibilityState !== "visible") return;
    try {
      if ((await navigator.permissions.query({ name: "clipboard-read" })).state !== "granted") return;
      const t = await navigator.clipboard.readText();
      if (!parseLog(t).ok) return;
      const id = await logId(t);
      if ((await store.games()).some(g => g.id === id)) return;
      found = t; $("gm-found").hidden = false;
    } catch {}
  }
  addEventListener("focus", checkClipboard);
  document.addEventListener("visibilitychange", checkClipboard);
  $("gm-found-save").addEventListener("click", () => { $("gm-found").hidden = true; if (found) handle(found); found = null; });
  $("gm-found-no").addEventListener("click", () => { $("gm-found").hidden = true; found = null; });

  return { render: () => { render(); checkClipboard(); } };
}
