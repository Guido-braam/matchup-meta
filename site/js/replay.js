// Replay viewer (spec .scratch/battle-logs, ticket 07): the board from replay() at each step, the log in step
// with it, and controls to step, play and jump to a turn. Phone first: board above, log below.
// Tapping a card image zooms it (the global handler in cards.js, as in Deck Lab).
import { replay } from "./gamestate.js";
import { findCard, cardById, cardTile } from "./cards.js";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SPEEDS = [["Slow", 2000], ["Normal", 1000], ["Fast", 400]];
const short = n => n.replace(/^Basic /, "").replace(/ Energy$/, "");

// el: an empty element; game: a parsed game; index: the Card index or null (then name tiles, no images).
export function mountReplay(el, game, index) {
  const states = replay(game), ev = game.events, last = ev.length - 1;
  const who = s => (s === "me" ? "You" : game.players.opp);
  const turnLabel = t => (t ? `Turn ${t} · ${who(ev.find(e => e.turn === t).turnSide)}` : "Setup");
  const turns = [...new Set(ev.map(e => e.turn))];
  const firstOf = t => ev.findIndex(e => e.turn === t);
  let i = 0, timer = null, speed = 1000;

  const tile = m => {
    const card = (m.id && cardById(index, m.id)) || findCard(index, null, null, m.name);
    const att = [...m.energy.map(short), ...m.tools].join(", ");
    return `<div class="rp-mon">${cardTile(card, { name: m.name })}${m.damage ? `<span class="rp-dmg">${m.damage}</span>` : ""}
      ${att ? `<span class="rp-att" title="${esc(att)}">${esc(att)}</span>` : ""}</div>`;
  };
  const stats = (s, side) => `<div class="rp-stats"><b>${esc(who(side))}</b>
    <span>Prizes ${s.prizes}</span><span>Hand ${s.handCount}</span><span>Deck ${s.deck}</span><span>Discard ${s.discard}</span></div>`;
  const side = (s, sideName) => {
    const active = `<div class="rp-active">${s.active ? tile(s.active) : `<div class="rp-empty">No Active</div>`}</div>`;
    const bench = `<div class="rp-bench">${s.bench.map(tile).join("")}</div>`;
    return `<div class="rp-side ${sideName}">${sideName === "opp" ? stats(s, "opp") + bench + active : active + bench + stats(s, "me")}</div>`;
  };

  el.innerHTML = `<div class="rp-controls">
      <button type="button" class="btn" data-rp="prev-turn" aria-label="Previous turn">⏮</button>
      <button type="button" class="btn" data-rp="prev" aria-label="Previous step">‹</button>
      <button type="button" class="btn primary" data-rp="play" aria-label="Play">▶</button>
      <button type="button" class="btn" data-rp="next" aria-label="Next step">›</button>
      <button type="button" class="btn" data-rp="next-turn" aria-label="Next turn">⏭</button>
      <select data-rp="turn" aria-label="Jump to a turn">${turns.map(t => `<option value="${t}">${esc(turnLabel(t))}</option>`).join("")}</select>
      <select data-rp="speed" aria-label="Speed">${SPEEDS.map(([n, ms]) => `<option value="${ms}"${ms === speed ? " selected" : ""}>${n}</option>`).join("")}</select>
    </div>
    <input type="range" class="rp-range" data-rp="step" min="0" max="${last}" value="0" aria-label="Step">
    <div class="rp-board" aria-live="polite"></div>
    <ol class="rp-log">${ev.map((e, k) => (k === 0 || e.turn !== ev[k - 1].turn ? `<li class="rp-turn">${esc(turnLabel(e.turn))}</li>` : "") +
      `<li data-k="${k}" class="${e.side === "me" ? "me" : ""}${e.sub ? " sub" : ""}">${esc(e.text ?? e.type)}</li>`).join("")}</ol>`;
  const $ = q => el.querySelector(q), log = $(".rp-log");

  function show(k) {
    i = Math.max(0, Math.min(last, k));
    const s = states[i];
    $(".rp-board").innerHTML = side(s.opp, "opp") +
      `<div class="rp-mid">${s.stadium ? `Stadium: <b>${esc(s.stadium.name)}</b>` : "No Stadium"}
        ${s.uncertain ? `<span class="rp-unsure">The log does not say which Pokémon; this step is a guess.</span>` : ""}</div>` +
      side(s.me, "me") +
      `<p class="rp-hand"><b>Your hand (known)</b> ${s.me.hand.length ? esc(s.me.hand.join(", ")) : "–"}</p>`;
    $("[data-rp=step]").value = i;
    $("[data-rp=turn]").value = s.turn;
    log.querySelector(".now")?.classList.remove("now");
    const li = log.querySelector(`[data-k="${i}"]`);
    li.classList.add("now");
    log.scrollTop = li.offsetTop - log.clientHeight / 2; // scroll the log only, not the page
  }
  const stop = () => { clearInterval(timer); timer = null; $("[data-rp=play]").textContent = "▶"; $("[data-rp=play]").ariaLabel = "Play"; };
  const play = () => {
    if (i >= last) show(0);
    $("[data-rp=play]").textContent = "⏸"; $("[data-rp=play]").ariaLabel = "Pause";
    timer = setInterval(() => { if (!el.isConnected || i >= last) return stop(); show(i + 1); }, speed);
  };
  const turnStart = k => firstOf(states[k].turn);

  el.addEventListener("click", e => {
    const b = e.target.closest("[data-rp], [data-k]");
    if (!b) return;
    if (b.dataset.k) { stop(); return show(+b.dataset.k); }
    const a = b.dataset.rp;
    if (a === "play") return timer ? stop() : play();
    if (a === "turn" || a === "speed" || a === "step") return;
    stop();
    if (a === "prev") show(i - 1);
    if (a === "next") show(i + 1);
    // Previous turn: to the start of this turn, or of the one before when already there.
    if (a === "prev-turn") show(turnStart(i) < i ? turnStart(i) : turnStart(Math.max(0, i - 1)));
    // Next turn: the start of the next turn; in the last turn, the end of the game.
    if (a === "next-turn") { const n = ev.findIndex((x, k) => k > i && x.turn !== ev[i].turn); show(n < 0 ? last : n); }
  });
  el.addEventListener("input", e => { if (e.target.dataset.rp === "step") { stop(); show(+e.target.value); } });
  el.addEventListener("change", e => {
    const a = e.target.dataset.rp;
    if (a === "turn") { stop(); show(firstOf(+e.target.value)); }
    if (a === "speed") { speed = +e.target.value; if (timer) { stop(); play(); } }
  });
  show(0);
}
