// My games (spec .scratch/battle-logs): pasting a battle log, linking it to a list in My lists, the games list.
// The functions at the top are pure (tested in tests/unit/mygames.test.js); initMyGames() is the view.
import { parseLog, PARSER_VERSION } from "./battlelog.js";
import { logId } from "./gamestore.js";
import { latest } from "./mylists.js";
import { reconstruct } from "./opponent.js";
import { mountReplay } from "./replay.js";
import { cardTile, cardById, findCard } from "./cards.js";
import { norm } from "./insights.js";

export const GAME_SCHEMA = 1;

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
  // No list has every card shown: the Deck list picked above the Paste button (the last used list).
  const use = fit.list ?? lists.find(l => l.id === lastListId && !l.archived) ?? null;
  const record = {
    id, schema: GAME_SCHEMA, parser: PARSER_VERSION, added: now, raw,
    listId: use?.id ?? null, listVersion: use ? fit.version ?? latest(use).v : null,
    oppDeck: reconstruct(r.game, labs).deck, oppDeckSet: null,
    game: r.game,
  };
  const status = await store.addGame(record);
  return status === "added" ? { status, record, fit } : status === "duplicate" ? { status, record } : { status: "failed" };
}

// A game saved without a list, linked to a list saved later that has every card I showed; else the same object.
export function linkLater(g, lists, lastListId = null) {
  if (g.listId != null) return g; // "" = no list, picked on purpose
  const fit = fitVersion(lists, cardsSeen(g.game, "me"), lastListId);
  return fit.list ? { ...g, listId: fit.list.id, listVersion: fit.version } : g;
}

// A game saved by an older parser, read again from its raw log; unchanged when it is current or no longer parses.
export function refreshGame(g, index) {
  if ((g.parser || 0) >= PARSER_VERSION) return g;
  const r = parseLog(g.raw, index);
  return r.ok ? { ...g, parser: PARSER_VERSION, game: r.game } : g;
}

// Keeping data on phones (ticket 11).
// Remind to export when games were added after the last export, and that export is over 14 days old or never happened.
// -> the number of games not in a backup, or 0 for no reminder. lastExport and now: ISO strings.
export const REMIND_DAYS = 14;
export function exportReminder(games, lastExport, now) {
  const fresh = games.filter(g => !lastExport || g.added > lastExport).length;
  if (!fresh) return 0;
  return !lastExport || Date.parse(now) - Date.parse(lastExport) > REMIND_DAYS * 864e5 ? fresh : 0;
}
// Safari on iPhone or iPad, not opened from the home screen: there Safari may delete the site's data after
// a week without a visit, so the "add to home screen" tip applies. iPadOS reports itself as a Mac with touch.
export function iosSafari({ userAgent = "", platform = "", maxTouchPoints = 0, standalone = false } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return ios && !standalone && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent);
}

// ---------- View ----------
// deps: {$, esc, store, storage, loadCardIndex, labs: () => labs.json or null, isCurrent: () => bool,
//   listView: (cards, index, label) -> HTML of a Regional list}.
const LAST_LIST_KEY = "matchup-meta-last-list";
export const LAST_EXPORT_KEY = "matchup-meta-last-export", HOME_TIP_KEY = "matchup-meta-home-tip";
export function initMyGames({ $, esc, store, storage, loadCardIndex, labs, isCurrent, listView }) {
  let shown = null; // id of the game in the pop-up
  let fresh = null; // id of the game pasted last on this visit: the Deck list picker relinks it
  let page = 0;     // the games list, PER_PAGE games a page, newest first
  const PER_PAGE = 10;

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
    // Ask the browser to keep this site's data (Chrome decides by itself; Safari and Firefox may ask or say no).
    if (r.status === "added") navigator.storage?.persist?.().catch(() => {});
    $("gm-manual").hidden = true; $("gm-text").value = "";
    shown = fresh = r.record.id;
    page = 0;
    // A new game just opens; only a game saved before gets a line, with a way back to it.
    status("");
    await render(r.status === "duplicate" ? `This game is already saved (added ${fmt(r.record.added)}).` : "");
    open();
  }

  // The game in the pop-up: result, list, opponent's deck and cards, replay.
  function card(g, lists, index) {
    const G = g.game, list = lists.find(l => l.id === g.listId);
    const miss = list ? missingCards(list, cardsSeen(G, "me")) : [];
    const reason = { prizes: "on Prize cards", concede: G.result === "win" ? "opponent conceded" : "you conceded" }[G.reason] || "";
    const decks = [...(labs()?.archetypes || [])].sort((a, b) => a.name.localeCompare(b.name));
    const opp = g.oppDeckSet ?? g.oppDeck;
    const listOpts = lists.filter(l => !l.archived || l.id === g.listId)
      .map(l => `<option value="${esc(l.id)}"${l.id === g.listId ? " selected" : ""}>${esc(listText(l))}</option>`).join("");
    return `<div class="gm-head"><span class="pill ${G.result === "win" ? "good" : "bad"}">${G.result === "win" ? "Win" : "Loss"}</span>
        <span>${esc(reason)}</span><span>· went ${G.wentFirst ? "first" : "second"}</span><span>· ${G.turns} turns</span><span>· Prize cards ${G.prizes.me}–${G.prizes.opp}</span></div>
      <p class="gm-msg gm-meta">Added ${fmt(g.added)}</p>
      <hr class="gm-sep">
      ${!lists.length ? `<p class="gm-msg">Save your list in <a href="#lab">Deck Lab</a> first, then pick it under My deck.</p>` : ""}
      ${!list && lists.length ? `<p class="gm-msg warn">No list in My lists has every card you showed in this game. Pick the one you played under My deck.</p>` : ""}
      ${miss.length ? `<p class="gm-msg warn">Not in ${esc(list.name)}: ${esc(miss.join(", "))}. Was this game played with another list or version?</p>` : ""}
      <div class="gm-pair">
        <label class="gm-field">My deck<select data-gm="list"><option value="">No list</option>${listOpts}</select></label>
        <label class="gm-field">Opponent's deck<select data-gm="opp"><option value="">Other</option>
          ${decks.map(a => `<option value="${esc(a.id)}"${a.id === opp ? " selected" : ""}>${esc(a.name)}</option>`).join("")}
        </select></label>
      </div>
      ${reconHtml(reconstruct(G, labs()), index)}
      <details class="gm-replay"><summary>Replay</summary><div class="rp-root"></div></details>`;
  }

  // What the opponent showed, as card tiles with the copies proven plus one tile for the unknown cards,
  // and the closest Regional lists.
  const CAT = { Pokemon: "pokemon", Trainer: "trainer", Energy: "energy" };
  let similar = null; // the closest Regional list of the game in the pop-up, for its arrow button
  function reconHtml(r, index) {
    similar = null;
    if (!r.seen.length) return `<p class="gm-msg">The opponent showed no cards.</p>`;
    const pct = s => Math.round(s * 100) + "%";
    const tile = c => {
      const k = c.id ? cardById(index, c.id) : findCard(index, null, null, c.name);
      return cardTile(k, { name: c.name, cat: CAT[k?.category] ?? (/Energy$/.test(c.name) ? "energy" : "pokemon"), count: c.copies });
    };
    const unknown = r.unknown ? `<div class="ctile ph gm-unk"><span class="band"></span><span class="nm">Not shown</span><span class="art">?</span><span class="ft"></span><span class="cnt">${r.unknown}</span></div>` : "";
    // Only the closest Regional list, as one line next to the count.
    const s = r.similar[0], th = n => n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th");
    similar = s ? { cards: s.cards, index, title: `${s.deckName} · ${th(s.place)} of ${s.of.toLocaleString("en-US")} · ${s.event}` } : null;
    const sim = s ? ` <span class="gm-sim"><span class="gm-meta" title="${esc(s.deckName)} · share of the cards seen that this Regional list has">${th(s.place)} of ${s.of} · ${esc(s.event)} · ${pct(s.score)} match</span>
      <button class="gm-sim-go" type="button" data-gm="similar" aria-label="View this list" title="View this list">→</button></span>` : "";
    return `<details class="gm-recon"><summary>Opponent's cards: ${r.known} of 60 seen${sim}</summary>
      <div class="cgrid">${r.seen.map(tile).join("")}${unknown}</div>
    </details>`;
  }

  const pct = p => (p == null ? "–" : Math.round(p * 100) + "%");

  async function render(msg = "") {
    let [games, lists] = await Promise.all([store.games(), store.lists()]);
    if (games.some(g => (g.parser || 0) < PARSER_VERSION)) {
      const index = await loadCardIndex().catch(() => null);
      games = await Promise.all(games.map(async g => { const n = refreshGame(g, index); if (n !== g) await store.putGame(n); return n; }));
    }
    // Games pasted before their list was saved get it now.
    games = await Promise.all(games.map(async g => { const n = linkLater(g, lists, storage.read(LAST_LIST_KEY)); if (n !== g) await store.putGame(n); return n; }));
    games.sort((a, b) => b.added.localeCompare(a.added));
    const g = games.find(x => x.id === shown);
    if (g) {
      $("gm-dialog-title").textContent = `Game #${games.length - games.indexOf(g)}`; // numbered by when it was pasted, oldest #1
      $("gm-game").innerHTML = card(g, lists, await loadCardIndex().catch(() => null));
    }
    else $("gm-dialog").close();
    if (msg) status(`<p class="gm-msg">${esc(msg)}${g ? ` <button class="link-btn" type="button" data-gm="show">Show game</button>` : ""}</p>`);
    const last = storage.read(LAST_LIST_KEY);
    $("gm-deck").innerHTML = `<option value="">Pick a list…</option>` + lists.filter(l => !l.archived || l.id === last)
      .map(l => `<option value="${esc(l.id)}"${l.id === last ? " selected" : ""}>${esc(listText(l))}</option>`).join("");
    const label = id => { const l = lists.find(x => x.id === id); return l ? listText(l) : "no list"; };
    // Keeping data: the home screen tip (once, on iPhone/iPad Safari, after the first game) and the export reminder.
    $("gm-tip").hidden = !games.length || storage.read(HOME_TIP_KEY) === true || !iosSafari(navigator);
    const behind = remindOff ? 0 : exportReminder(games, storage.read(LAST_EXPORT_KEY), new Date().toISOString());
    $("gm-remind").hidden = !behind;
    $("gm-remind-text").textContent = `${behind} game${behind === 1 ? " is" : "s are"} not in a backup yet. Export ${behind === 1 ? "it" : "them"} to a file, so ${behind === 1 ? "it is" : "they are"} safe if this browser clears its data.`;
    $("gm-count").textContent = games.length;
    const pages = Math.max(1, Math.ceil(games.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const pager = pages < 2 ? "" : `<div class="gm-pager">
        <button class="btn" type="button" data-page="${page - 1}"${page ? "" : " disabled"}>← Newer</button>
        <span>Page ${page + 1} of ${pages}</span>
        <button class="btn" type="button" data-page="${page + 1}"${page < pages - 1 ? "" : " disabled"}>Older →</button></div>`;
    $("gm-list").innerHTML = games.length ? games.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(x => `<button type="button" class="gm-row${x.id === shown ? " current" : ""}" data-game="${esc(x.id)}">
        <span class="pill ${x.game.result === "win" ? "good" : "bad"}">${x.game.result === "win" ? "W" : "L"}</span>
        <span class="gm-vs">vs ${esc(deckName(x.oppDeckSet ?? x.oppDeck))}</span>
        <span class="gm-meta">${x.game.wentFirst ? "1st" : "2nd"} · ${esc(label(x.listId))} · ${fmt(x.added)}</span></button>`).join("") + pager
      : `<p class="note">No games yet. Paste your first battle log above.</p>`;
  }

  async function update(id, change) {
    const g = (await store.games()).find(x => x.id === id);
    if (!g) return;
    await store.putGame({ ...g, ...change });
    await render();
  }
  // The pop-up: opens after a paste and from the games list; × , Esc or a click beside it closes it.
  const dlg = $("gm-dialog");
  const open = () => { if (shown && !dlg.open) dlg.showModal(); };
  // Esc with a card zoomed in closes only the zoom, not the pop-up.
  dlg.addEventListener("keydown", e => { const z = dlg.querySelector(".card-zoom"); if (e.key === "Escape" && z) { e.preventDefault(); z.remove(); } });
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
  // The arrow next to the closest Regional list: that list in a second pop-up, as on the Deck tab.
  const ldlg = $("gm-list-dialog");
  dlg.addEventListener("click", e => {
    if (!e.target.closest('[data-gm="similar"]') || !similar) return;
    e.preventDefault(); // inside the summary: do not fold the cards open
    $("gm-list-title").textContent = similar.title;
    $("gm-list-body").innerHTML = listView(similar.cards, similar.index, similar.title);
    ldlg.showModal();
  });
  ldlg.addEventListener("click", e => {
    if (e.target === ldlg || e.target.closest("[data-close]")) ldlg.close();
    if (e.target.closest("button[data-lab]")) { ldlg.close(); dlg.close(); } // Open in Deck Lab goes to the Deck Lab tab
  });
  $("gm-result").addEventListener("click", e => { if (e.target.closest('[data-gm="show"]')) { shown = fresh ?? shown; render().then(open); } });
  $("gm-game").addEventListener("change", e => {
    if (e.target.dataset.gm === "opp") update(shown, { oppDeckSet: e.target.value || "" });
    // My deck: "" = no list on purpose, so a list saved later does not link it (linkLater only takes null).
    if (e.target.dataset.gm === "list") store.lists().then(ls => {
      const l = ls.find(x => x.id === e.target.value);
      update(shown, { listId: l?.id ?? "", listVersion: l ? latest(l).v : null });
    });
  });
  // Deck list: the list for the next games, and for the game just pasted on this visit.
  $("gm-deck").addEventListener("change", async e => {
    const l = (await store.lists()).find(x => x.id === e.target.value);
    storage.write(LAST_LIST_KEY, l?.id ?? null);
    if (fresh) return update(fresh, { listId: l?.id ?? null, listVersion: l ? latest(l).v : null });
    render();
  });
  // Replay: built when opened (toggle does not bubble, so listen in the capture phase).
  $("gm-game").addEventListener("toggle", async e => {
    const d = e.target;
    if (!d.classList?.contains("gm-replay") || !d.open || d.dataset.ready) return;
    d.dataset.ready = "1";
    const [g, index] = await Promise.all([store.games().then(gs => gs.find(x => x.id === shown)), loadCardIndex().catch(() => null)]);
    if (g) mountReplay(d.querySelector(".rp-root"), g.game, index);
  }, true);
  let remindOff = false; // "Not now": until the next visit
  $("gm-tip-ok").addEventListener("click", () => { storage.write(HOME_TIP_KEY, true); $("gm-tip").hidden = true; });
  $("gm-remind-no").addEventListener("click", () => { remindOff = true; $("gm-remind").hidden = true; });
  $("gm-remind-export").addEventListener("click", () => document.getElementById("export-settings").click());
  $("gm-list").addEventListener("click", e => {
    const p = e.target.closest("[data-page]");
    if (p) { page = +p.dataset.page; return render(); }
    const b = e.target.closest("[data-game]");
    if (!b) return;
    shown = b.dataset.game;
    render().then(open);
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

  // Chrome and Edge only: look at the clipboard when the visitor comes back to the tab. Only once they allowed
  // clipboard access (the browser asks on the first Paste battle log); this never asks by itself.
  const canAuto = !!navigator.permissions?.query && !!navigator.clipboard?.readText && /Chrome\//.test(navigator.userAgent);
  let found = null;
  async function checkClipboard() {
    if (!canAuto || !isCurrent() || document.visibilityState !== "visible") return;
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
