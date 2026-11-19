// The Analysis tab (spec .scratch/analysis-rework): pickers for a list version and an opponent deck, then the
// summary, the matchups and the insights of those games. The numbers come from insights.js.
import { latest } from "./mylists.js";
import { LAST_LIST_KEY, currentGames } from "./mygames.js";
import { select, summary, matchups, record } from "./insights.js";

// deps: {$, esc, store, storage, loadCardIndex, labs: () => labs.json or null}.
export function initAnalysis({ $, esc, store, storage, loadCardIndex, labs }) {
  let pick = null; // "listId|v" or "listId|all"
  let opp;         // undefined = all opponents, null = Other, else a deck id
  const deckName = id => (id ? labs()?.archetypes.find(a => a.id === id)?.name ?? "Unknown deck" : "Other");
  const OTHER = "~other";
  const oppValue = d => (d === undefined ? "" : d ?? OTHER);

  async function render() {
    const [games, lists] = await Promise.all([currentGames(store, loadCardIndex), store.lists()]);
    const used = lists.filter(l => !l.archived || games.some(g => g.listId === l.id));
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
    const s = summary(sel);
    $("an-body").innerHTML = `<p class="an-sum"><b>${record(s)}</b> · going first ${record(s.first)} · going second ${record(s.second)}</p>
      <hr class="an-sep">
      <h3 class="an-h">Matchups</h3>
      <div class="an-mus">${mus.map(m => `<button type="button" class="an-mu${m.deck === opp ? " current" : ""}" data-opp="${esc(oppValue(m.deck))}">
        <span class="gm-vs">${esc(deckName(m.deck))}</span><span class="an-rec">${record(m)}</span></button>`).join("")}</div>`;
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
