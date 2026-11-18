// My games (spec .scratch/battle-logs): pasting a battle log, linking it to a list in My lists, the games list.
// The functions at the top are pure (tested in tests/unit/mygames.test.js); initMyGames() is the view.
import { parseLog, PARSER_VERSION } from "./battlelog.js";
import { logId } from "./gamestore.js";
import { latest } from "./mylists.js";
import { reconstruct } from "./opponent.js";
import { mountReplay } from "./replay.js";
import { overview, catalogue, norm, MIN, explainContext, EXPLAIN_SYSTEM, explainMessages } from "./insights.js";

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
// deps: {$, esc, store, storage, loadCardIndex, labs: () => labs.json or null, data: () => data.json or null, isCurrent: () => bool,
//   ai: () => createAI() client or null without an API key, md: markdown -> safe HTML, aiError: error -> message}.
const LAST_LIST_KEY = "matchup-meta-last-list", AUTO_KEY = "matchup-meta-clipboard-check";
export function initMyGames({ $, esc, store, storage, loadCardIndex, labs, data, isCurrent, ai, md, aiError }) {
  let shown = null; // id of the game in the result card
  let pick = null;  // the analysis picker: "" all games, "L:<list id>", "V:<list id>:<version>", "none"; null = not chosen yet

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
    pick = r.record.listId ? "L:" + r.record.listId : "";
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
      <details class="gm-replay"><summary>Replay</summary><div class="rp-root"></div></details>
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

  // The analysis of the picked games (spec: catalogue items 1-3).
  const pct = p => (p == null ? "–" : Math.round(p * 100) + "%");
  const ci = r => (r.n ? `95%: ${pct(r.lo)}–${pct(r.hi)}` : "");
  const wl = r => `${r.k}–${r.n - r.k}`;
  function statsHtml(o, myDeck, c, listPicked) {
    const tile = (label, big, sub) => `<div class="gm-tile"><span class="gm-tl">${label}</span><span class="gm-big">${big}</span><span class="gm-meta">${sub}</span></div>`;
    const why = r => [["prizes", "on Prize cards"], ["concede", "by concession"], ["other", "other"]].filter(([k]) => r[k]).map(([k, t]) => `${r[k]} ${t}`).join(", ") || "none";
    const rows = o.matchups.map(m => `<tr><td>${esc(m.deck ? deckName(m.deck) : "Other")}</td><td class="num">${wl(m.record)}</td>
      <td class="num" title="${ci(m.record)}">${pct(m.record.p)}</td><td class="num" title="${m.first.n} games going first">${m.first.n ? pct(m.first.p) : "–"}</td>
      <td class="num"${m.field ? ` title="${m.field.n} tournament games"` : ""}>${pct(m.field?.p)}</td></tr>`).join("");
    return `<div class="gm-tiles">
        ${tile("Record", wl(o.record), `${o.games} game${o.games === 1 ? "" : "s"}`)}
        ${tile("Winrate", pct(o.record.p), ci(o.record))}
        ${tile("Going first", pct(o.first.p), o.first.n ? `${wl(o.first)} · ${ci(o.first)}` : "no games")}
        ${tile("Going second", pct(o.second.p), o.second.n ? `${wl(o.second)} · ${ci(o.second)}` : "no games")}
        ${tile("Game length", o.avgTurns == null ? "–" : o.avgTurns.toFixed(1), "turns, both players")}
      </div>
      <p class="gm-msg gm-why">Wins: ${why(o.reasons.win)}. Losses: ${why(o.reasons.loss)}.</p>
      <h3 class="gm-h3">Per opponent deck</h3>
      <div class="table-wrap"><table class="gm-mu"><thead><tr><th>Opponent</th><th class="num">W–L</th><th class="num">Win</th><th class="num">1st</th><th class="num">Field</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="note">Win: your winrate (hover or long-press for the 95% range). 1st: your winrate going first. Field: ${myDeck ? `how ${esc(deckName(myDeck))} does against that deck at tournaments (Trainerhill)` : "pick one list to compare with tournaments"}.</p>
      ${insightsHtml(c, o.games, listPicked)}
      ${explainHtml()}`;
  }
  // Explain with Claude (ticket 10): only on request, with the visitor's own key; sends explainContext(), never logs.
  let explainCtx = null, explainKey = "", explained = null, explainCtl = null;
  function explainHtml() {
    const done = explained?.key === explainKey ? explained : null;
    return `<div class="gm-explain"><h3 class="gm-h3">Explain with Claude</h3>
      ${ai() ? `<div class="gm-explain-row"><button class="btn primary" type="button" data-gm="explain"${explainCtl ? " disabled" : ""}>${done ? "Explain again" : "Explain with Claude"}</button>
          <button class="link-btn" type="button" data-gm="explain-stop"${explainCtl ? "" : " hidden"}>Stop</button></div>
        <p class="note">Sends only the numbers above, with deck and card names, never your battle logs. Uses your own Claude credit.</p>`
        : `<p class="note">Explain with Claude is off: it uses Claude with your own Anthropic API key. <a href="#advice" data-goto="advice">Add your API key</a> in Ask Claude to turn it on.</p>`}
      <p class="gm-msg" data-gm="explain-state" role="status">${done?.error ? esc(done.error) : ""}</p>
      <div class="gm-explained">${done?.text ? md(done.text) : ""}</div></div>`;
  }
  async function explain() {
    const client = ai();
    if (!client || !explainCtx || explainCtl) return;
    const key = explainKey, box = () => $("gm-stats").querySelector(".gm-explain");
    explainCtl = new AbortController();
    explained = { key, text: "" };
    const show = () => { const b = box(); if (b && explainKey === key) b.outerHTML = explainHtml(); };
    show();
    const state = $("gm-stats").querySelector('[data-gm="explain-state"]');
    if (state) state.textContent = "Claude is reading your numbers…";
    try {
      const res = await client.chat({ system: EXPLAIN_SYSTEM, messages: explainMessages(explainCtx), signal: explainCtl.signal,
        onText: t => { explained.text = t; const out = box()?.querySelector(".gm-explained"); if (out && explainKey === key) out.innerHTML = md(t); } });
      explained.text = res.text;
      if (res.truncated) explained.error = "The explanation was cut off.";
    } catch (e) {
      explained.text = e?.text || "";
      explained.error = e?.code === "cancelled" ? "Stopped." : aiError(e);
    } finally {
      explainCtl = null;
      show();
    }
  }
  $("gm-stats").addEventListener("click", e => {
    const k = e.target.closest("[data-gm]")?.dataset.gm;
    if (k === "explain") explain();
    if (k === "explain-stop") explainCtl?.abort();
  });
  // The insight catalogue (items 4-8): comparisons, my Pokémon Knocked Out first, and card use.
  function insightsHtml(c, n, listPicked) {
    const grp = r => `<span class="gm-meta">(${r.n} games, ${ci(r)})</span>`;
    const item = r => `<li><b>${esc(r.subject)}${r.deck !== undefined ? ` against ${esc(r.deck ? deckName(r.deck) : "Other")}` : ""}</b>
      goes with <span class="pill ${r.gap >= 0 ? "good" : "bad"}">${pct(r.yes.p)}</span> wins ${grp(r.yes)}, against ${pct(r.no.p)} otherwise ${grp(r.no)}.</li>`;
    // The largest gaps first; the rest one tap away, so hundreds of games do not make an endless list.
    const TOP = 8, more = c.insights.length - TOP;
    const ins = c.insights.slice(0, TOP).map(item).join("") + (more > 0 ? `<li class="gm-more"><details><summary>${more} more</summary><ul class="gm-ins">${c.insights.slice(TOP).map(item).join("")}</ul></details></li>` : "");
    const down = c.firstDown.map(d => `<li>Against <b>${esc(d.deck ? deckName(d.deck) : "Other")}</b>, your first Pokémon Knocked Out:
      ${d.top.map(t => `${esc(t.name)} ${t.count}×`).join(", ")} <span class="gm-meta">(${d.games} games)</span></li>`).join("");
    const use = c.usage.map(u => `<tr><td>${esc(u.name)}${u.rare ? ' <span class="pill bad">rarely played</span>' : ""}${u.never ? ` <span class="pill bad">not played in last ${u.recent}</span>` : ""}</td>
      <td class="num">${pct(u.shown)}</td><td class="num">${pct(u.played)}</td><td class="num">${u.avgTurn == null ? "–" : u.avgTurn.toFixed(1)}</td></tr>`).join("");
    return `<h3 class="gm-h3">Insights</h3>
      ${ins ? `<ul class="gm-ins">${ins}</ul>` : ""}
      ${down ? `<ul class="gm-ins">${down}</ul>` : ""}
      ${!ins && !down ? `<p class="note">Insights show up when each group compared has ${MIN} games or more (${n} game${n === 1 ? "" : "s"} here so far).</p>`
        : `<p class="note">"Goes with" means these happened together in your games, not that one caused the other. Only comparisons with ${MIN}+ games on each side are shown.</p>`}
      ${use ? `<h3 class="gm-h3">Card use</h3><div class="table-wrap"><table class="gm-mu"><thead><tr><th>Card</th><th class="num">Seen</th><th class="num">Played</th><th class="num">Turn</th></tr></thead><tbody>${use}</tbody></table></div>
        <p class="note">Seen: share of games the log shows you had the card. Played: share of games you played it. Turn: your average turn it was first played (0 = setup).</p>`
        : listPicked ? "" : `<p class="note">Pick one list to see how each of its cards is used.</p>`}`;
  }
  // The picker: all games, each list (all versions, and each version when there are several), games without a list.
  function pickerHtml(games, lists) {
    const count = f => games.filter(f).length, opts = [["", `All games (${games.length})`]];
    for (const l of lists) {
      const n = count(g => g.listId === l.id);
      if (!n) continue;
      const vs = [...new Set(games.filter(g => g.listId === l.id).map(g => g.listVersion))].sort((a, b) => a - b);
      opts.push(["L:" + l.id, `${l.name}${vs.length > 1 ? " · all versions" : ""} (${n})`]);
      if (vs.length > 1) vs.forEach(v => opts.push([`V:${l.id}:${v}`, `${l.name} · v${v} (${count(g => g.listId === l.id && g.listVersion === v)})`]));
    }
    const none = count(g => !lists.some(l => l.id === g.listId));
    if (none) opts.push(["none", `Games without a list (${none})`]);
    if (!opts.some(([v]) => v === pick)) pick = opts.some(([v]) => v === "L:" + storage.read(LAST_LIST_KEY)) ? "L:" + storage.read(LAST_LIST_KEY) : "";
    return opts.map(([v, t]) => `<option value="${esc(v)}"${v === pick ? " selected" : ""}>${esc(t)}</option>`).join("");
  }
  const picked = (g, lists) => {
    if (!pick) return true;
    if (pick === "none") return !lists.some(l => l.id === g.listId);
    const [k, id, v] = pick.split(":");
    return g.listId === id && (k === "L" || g.listVersion === +v);
  };

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
    $("gm-analysis").hidden = !games.length;
    $("gm-pick").innerHTML = pickerHtml(games, lists);
    const mine = games.filter(x => picked(x, lists)), pickedList = pick?.startsWith("L:") || pick?.startsWith("V:") ? lists.find(l => l.id === pick.split(":")[1]) : null;
    // The cards of the picked version, or the latest version when all versions of a list are picked.
    const version = pickedList && (pick.startsWith("V:") ? pickedList.versions.find(v => v.v === +pick.split(":")[2]) : latest(pickedList));
    const o = overview(mine, { data: data(), myDeck: pickedList?.deck ?? null }), c = catalogue(mine, { cards: version?.cards ?? null });
    explainCtx = explainContext(o, c, { deckName, list: pickedList ? (pick.startsWith("V:") ? `${pickedList.name} v${version.v}` : pickedList.name) : null, myDeck: pickedList?.deck ?? null });
    explainKey = pick + "|" + mine.map(x => x.id + (x.oppDeckSet ?? "")).join(","); // a new game or a correction asks for a new explanation
    $("gm-stats").innerHTML = mine.length ? statsHtml(o, pickedList?.deck ?? null, c, !!pickedList) : "";
    $("gm-list").innerHTML = mine.length ? mine.map(x => `<button type="button" class="gm-row${x.id === shown ? " current" : ""}" data-game="${esc(x.id)}">
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
  // Replay: built when opened (toggle does not bubble, so listen in the capture phase).
  $("gm-result").addEventListener("toggle", async e => {
    const d = e.target;
    if (!d.classList?.contains("gm-replay") || !d.open || d.dataset.ready) return;
    d.dataset.ready = "1";
    const [g, index] = await Promise.all([store.games().then(gs => gs.find(x => x.id === shown)), loadCardIndex().catch(() => null)]);
    if (g) mountReplay(d.querySelector(".rp-root"), g.game, index);
  }, true);
  $("gm-pick").addEventListener("change", e => { pick = e.target.value; render(); });
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
