// The Analysis tab (spec .scratch/analysis-rework): pickers for a list version and an opponent deck, then the
// summary, the matchups and the insights of those games. The numbers come from insights.js.
import { latest } from "./mylists.js";
import { LAST_LIST_KEY, currentGames } from "./mygames.js";
import { select, summary, matchups, record, prizeStats, MARGINS, playInsights, MIN } from "./insights.js";
import { replay } from "./gamestate.js";
import { findCard, cardImagePath } from "./cards.js";

// deps: {$, esc, store, storage, loadCardIndex, labs: () => labs.json or null}.
// CSS class of a margin class: "Close win" -> "m-close-win".
export const marginCls = m => "m-" + m.toLowerCase().replace(" ", "-");

export function initAnalysis({ $, esc, store, storage, loadCardIndex, labs }) {
  let pick = null; // "listId|v" or "listId|all"
  let opp;         // undefined = all opponents, null = Other, else a deck id
  const deckName = id => (id ? labs()?.archetypes.find(a => a.id === id)?.name ?? "Unknown deck" : "Other");
  const OTHER = "~other";
  const oppValue = d => (d === undefined ? "" : d ?? OTHER);

  async function render() {
    const [games, lists] = await Promise.all([currentGames(store, loadCardIndex), store.lists()]);
    const used = lists.filter(l => !l.archived || games.some(g => g.listId === l.id));
    $("an-pick").hidden = !used.length;
    if (!used.length) {
      $("an-body").innerHTML = `<p class="note">Save your list in <a href="#lab">Deck Lab</a> and paste a few games on <a href="#games">My games</a> first.</p>`;
      return;
    }
    // Start on the latest version of the last used list.
    if (!pick || !used.some(l => pick.startsWith(l.id + "|"))) {
      const l = used.find(x => x.id === storage.read(LAST_LIST_KEY)) ?? used[0];
      pick = `${l.id}|${latest(l).v}`;
    }
    const [listId, vs] = pick.split("|"), v = vs === "all" ? "all" : +vs;
    const count = (id, v) => select(games, { listId: id, v }).length;
    $("an-version").innerHTML = used.map(l => [
      `<option value="${esc(l.id)}|all">${esc(l.name)} · all versions (${count(l.id, "all")})</option>`,
      ...[...l.versions].reverse().map(x => `<option value="${esc(l.id)}|${x.v}">${esc(l.name)} · v${x.v} (${count(l.id, x.v)})</option>`),
    ].join("")).join("");
    $("an-version").value = pick;

    const mine = select(games, { listId, v });
    const mus = matchups(mine);
    if (opp !== undefined && !mus.some(m => m.deck === opp)) opp = undefined;
    $("an-opp").innerHTML = `<option value="">All opponents (${mine.length})</option>` +
      mus.map(m => `<option value="${esc(oppValue(m.deck))}">${esc(deckName(m.deck))} (${m.wins + m.losses})</option>`).join("");
    $("an-opp").value = oppValue(opp);

    const sel = opp === undefined ? mine : select(mine, { listId, v, opp });
    if (!sel.length) { $("an-body").innerHTML = `<p class="note">No games with this version yet.</p>`; return; }
    const s = summary(sel), p = prizeStats(sel), d1 = x => x.toFixed(1);
    // One block per margin class, as wide as its number of games; the name in the tooltip.
    const bar = MARGINS.filter(m => p.classes[m]).map(m => `<span class="an-seg ${marginCls(m)}" style="flex-grow:${p.classes[m]}" title="${m}: ${p.classes[m]}">${p.classes[m]}</span>`).join("");
    $("an-body").innerHTML = `<p class="an-sum"><b>${record(s)}</b> · going first ${record(s.first)} · going second ${record(s.second)}</p>
      <p class="an-sum an-prz">Prize cards per game: you ${d1(p.me)} · opponent ${d1(p.opp)} · close games ${p.close} of ${sel.length}</p>
      <div class="an-bar" aria-label="${MARGINS.filter(m => p.classes[m]).map(m => `${m}: ${p.classes[m]}`).join(", ")}">${bar}</div>
      <hr class="an-sep">
      <h3 class="an-h">Matchups</h3>
      <div class="an-mus">${mus.map(m => `<button type="button" class="an-mu${m.deck === opp ? " current" : ""}" data-opp="${esc(oppValue(m.deck))}">
        <span class="gm-vs">${esc(deckName(m.deck))}</span><span class="an-rec">${record(m)}</span></button>`).join("")}</div>
      <hr class="an-sep">
      <h3 class="an-h">Insights</h3>
      ${insightsHtml(sel, s, await loadCardIndex().catch(() => null))}`;
  }

  // At most 5 one-line insights; too few games: a yellow warning in their place.
  const replays = new WeakMap(); // replay() per game, kept while the game record lives
  const replayOf = game => { if (!replays.has(game)) replays.set(game, replay(game)); return replays.get(game); };
  function insightsHtml(sel, s, index) {
    const list = playInsights(sel, { replay: replayOf, deckName });
    if (!list.length) return `<p class="an-warn" role="status">Insights show up from ${MIN} games in each group, for example ${MIN} wins and ${MIN} losses. This selection has ${sel.length} game${sel.length === 1 ? "" : "s"} (${record(s)}).</p>`;
    const img = name => { const c = findCard(index, null, null, name); return c?.image ? `<img class="an-card" loading="lazy" src="${cardImagePath(c.imageId ?? c.id)}" alt="${esc(name)}" onerror="this.remove()">` : ""; };
    return `<ul class="an-ins">${list.map(r => `<li>${r.card ? img(r.card) : ""}<span>${esc(r.text)}${r.early ? ` <span class="an-early">early sign</span>` : ""}</span></li>`).join("")}</ul>`;
  }

  $("an-version").addEventListener("change", e => { pick = e.target.value; opp = undefined; render(); });
  const setOpp = val => { opp = val === "" ? undefined : val === OTHER ? null : val; render(); };
  $("an-opp").addEventListener("change", e => setOpp(e.target.value));
  $("an-body").addEventListener("click", e => {
    const b = e.target.closest("[data-opp]");
    if (b) setOpp(b.dataset.opp === oppValue(opp) ? "" : b.dataset.opp); // a second click shows all opponents again
  });
  return { render };
}
