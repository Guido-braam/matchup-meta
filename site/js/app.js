// View code: rendert de tabbladen en reageert op de bezoeker. De berekeningen (standaardniveau,
// verwachte winrate, tiers) staan in calc.js; Deck Lab in decklab.js.
import { computeMeta, CONTINENTS, LEVELS as CALC_LEVELS, exportSettings, importSettings } from "./calc.js";
import { DeckLab } from "./decklab.js";
import { createStorage } from "./storage.js";
import { createAI } from "./ai.js";

// lv = opgeslagen niveau, w = gewicht in de berekening (uit calc.js).
const LEVEL_LABELS = { 5: "Very often", 4: "Often", 3: "Regularly", 2: "Sometimes", 1: "Rarely", 0: "Never" };
const LEVELS = CALC_LEVELS.map(l => ({ lv: l.level, w: l.weight, label: LEVEL_LABELS[l.level] }));
const LABEL = Object.fromEntries(LEVELS.map(l => [l.lv, l.label]));
const WEIGHT = Object.fromEntries(LEVELS.map(l => [l.lv, l.w]));
// Zekerheid 1-5 op aantal games (95%-marge ongeveer ±22, ±13, ±8, ±5 procentpunt).
const certainty = g => g >= 400 ? 5 : g >= 150 ? 4 : g >= 60 ? 3 : g >= 20 ? 2 : 1;

let D = null;              // data.json (Trainerhill: matchups)
let L = null;              // labs.json (Limitless Labs: resultaten en decklists van de Regionals)
let labsById = new Map();  // deckId -> archetype uit labs.json
let localFrequencies = {}; // deckId -> level (alleen afwijkingen van de standaard)
let continent = "worldwide"; // id uit CONTINENTS; weegt het aandeel en zo de standaardniveaus
let meta = null;           // computeMeta(): per deck niveau, verwachte winrate en tier; tiergrenzen; matchups
let listMeta = null;       // dezelfde meta met Worldwide: de aanbevolen lijst hangt niet af van het continent (ADR 0003)
let selected = null;       // index van gekozen deck
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
// Eindpositie als Engels rangtelwoord: 1st, 2nd, 3rd, 11th, 22nd.
const ord = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return Number(n).toLocaleString("en-US") + (s[(v - 20) % 10] || s[v] || s[0]); };

// Per deck (index in D.archetypes), uit de laatste berekening.
const level = i => meta.decks[i].level;
const weight = i => meta.decks[i].weight;
const rating = i => meta.decks[i].rating;   // {fav, exp} of null
const tierOf = i => meta.decks[i].tier;     // "S" t/m "E", of null zonder verwachte winrate
const isDeck = i => meta.decks[i].isDeck;   // "Other" is geen deck
const matchup = (i, j) => meta.matchups[i][j];
// Tiergrens als tekst: 52.5% met decimaal.
const tierPct = x => pct(x, 1);

// Rekent alles opnieuw uit na een wijziging in de data of in Mijn meta.
function recompute() {
  meta = computeMeta(D, L, { localFrequencies, continent });
  listMeta = continent === "worldwide" ? meta : computeMeta(D, L, { localFrequencies });
  renderContinentNote();
  const T = meta.tiers;
  $("tier-legend").innerHTML = "Tier by expected winrate: " + T.map((t, k) =>
    `<span><b>${t.tier}</b> ${k === T.length - 1 ? "&lt; " + tierPct(T[k - 1].min) : "≥ " + tierPct(t.min)}</span>`).join("");
}

function spritesHtml(a, cls = "") {
  if (!a.sprites.length) return `<span class="sprites ${cls}"><span class="ph">${esc(a.name.slice(0, 2))}</span></span>`;
  return `<span class="sprites ${cls}">${a.sprites.map(s => `<img src="${s}" alt="">`).join("")}</span>`;
}

// ---------- Opslag van instellingen ----------
// Settings staan in de browser van de bezoeker (ADR 0002). Lukt opslaan niet, dan gelden de wijzigingen alleen dit bezoek.
const storage = createStorage();
// Eigen Anthropic API key van de bezoeker; zonder key staan Advice en Deck chat uit (ADR 0002).
let apiKey = null;
const chatOn = () => !!apiKey;
function saveSettings() {
  $("save-state").textContent = storage.saveSettings({ localFrequencies, continent })
    ? "Settings saved" : "Could not save; your changes only apply to this session";
}
// Alleen afwijkingen van de standaard bewaren: terug naar de standaard haalt de local frequency weg.
function setLevel(id, w) {
  const d = meta.decks.find(x => x.id === id);
  localFrequencies = { ...localFrequencies };
  if (w === d.defaultLevel) delete localFrequencies[id]; else localFrequencies[id] = w;
  saveSettings();
  renderAll();
}

// ---------- Continent ----------
const CONTINENT_NAME = Object.fromEntries(CONTINENTS.map(c => [c.id, c.name]));
$("continent").innerHTML = CONTINENTS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
// Zonder Regionals op het gekozen continent rekent calc.js met Worldwide; dat moet de bezoeker zien.
function renderContinentNote() {
  const { chosen, used } = meta.continent, note = $("continent-note");
  note.hidden = !L || chosen === used;
  note.textContent = note.hidden ? "" : `There are no Regionals in ${CONTINENT_NAME[chosen]} in season ${L.season}, so the defaults use Worldwide.`;
}
// Andere standaardniveaus, dezelfde local frequencies.
$("continent").addEventListener("change", e => { continent = e.target.value; saveSettings(); renderAll(); });

// ---------- Tier list ----------
function renderTiers() {
  const n = Object.keys(localFrequencies).length;
  $("tier-basis").textContent = `Expected winrate against your meta: ${CONTINENT_NAME[continent]}, ${n} change${n === 1 ? "" : "s"}`;
  const showNever = $("show-never").checked;
  const T = meta.tiers;
  const groups = Object.fromEntries(T.map(t => [t.tier, []]));
  D.archetypes.forEach((a, i) => {
    if (!isDeck(i)) return;
    if (!showNever && level(i) === 0) return;
    const r = rating(i);
    if (!r) return;
    groups[tierOf(i)].push({ i, a, e: r.exp });
  });
  $("tiers").innerHTML = T.map(({ tier: t, min }, k) => {
    const items = groups[t].sort((x, y) => y.e - x.e);
    const range = k === 0 ? `≥ ${tierPct(min)}` : k === T.length - 1 ? `< ${tierPct(T[k - 1].min)}` : `${tierPct(min)}+`;
    return `<div class="tier tier-${t}">
      <div class="tier-label">${t}<small>${range}</small></div>
      <div class="tiles">${items.length ? items.map(({ i, a, e }) =>
        `<button class="tile${level(i) === 0 ? " never" : ""}" data-deck="${i}" title="${esc(a.name)}: ${pct(e)} expected winrate">
          ${spritesHtml(a)}<span class="name">${esc(a.name)}</span></button>`).join("")
        : `<span class="empty-tier">No decks in this tier</span>`}</div>
    </div>`;
  }).join("");
}

// ---------- Mijn meta ----------
function renderMeta() {
  const q = $("meta-search").value.trim().toLowerCase();
  const onlyChanged = $("only-changed").checked;
  const rows = D.archetypes.map((a, i) => ({ a, i }))
    .filter(({ a }) => (!q || a.name.toLowerCase().includes(q)) && (!onlyChanged || a.id in localFrequencies));
  $("meta-list").innerHTML = rows.length ? rows.map(({ a, i }) => {
    const cur = level(i), { defaultLevel: def, defaultShare: ds } = meta.decks[i];
    return `<div class="meta-row">
      ${spritesHtml(a, "sm")}
      <div class="nm"><button data-deck="${i}">${esc(a.name)}</button>${a.id in localFrequencies ? '<span class="changed-dot" title="Local frequency"></span>' : ""}
        <div class="sub">Default: ${LABEL[def]} · ${pct(ds.share)} share ${ds.source === "regionals" ? "at Regionals" : "on Trainerhill"}${a.id in localFrequencies
          ? ` · <button class="reset-one" data-set="${esc(a.id)}" data-w="${def}" aria-label="Reset ${esc(a.name)} to default">Reset</button>` : ""}</div></div>
      <div class="seg" role="group" aria-label="How often do you meet ${esc(a.name)}?">
        ${LEVELS.map(l => `<button data-set="${esc(a.id)}" data-w="${l.lv}" aria-pressed="${cur === l.lv}" class="${def === l.lv ? "is-default" : ""}">${l.label}</button>`).join("")}
      </div>
    </div>`;
  }).join("") : `<div class="state">No decks found.</div>`;
}

// ---------- Deck-detail ----------
// Matchuplijsten: top 5, uitklapbaar. Breed scherm: beide kolommen tegelijk; smal (onder elkaar): per kolom.
const MU_TOP = 5;
let muOpen = { good: false, bad: false }, muOpenDeck = null;
const muMoreLabel = (open, n) => open ? "Show top 5 only" : `Show all ${n}`;
function toggleMu(key) {
  const open = !muOpen[key];
  if (matchMedia("(max-width: 860px)").matches) muOpen = { ...muOpen, [key]: open };
  else muOpen = { good: open, bad: open };
  for (const k of ["good", "bad"]) {
    const list = $("mu-" + k), btn = document.querySelector(`button[data-mu="${k}"]`);
    if (!list || !btn) continue;
    list.classList.toggle("limited", !muOpen[k]);
    btn.setAttribute("aria-expanded", String(muOpen[k]));
    btn.textContent = muMoreLabel(muOpen[k], list.children.length);
  }
  // Na inklappen de knop in beeld houden, anders sta je ineens ver onder de lijst.
  if (!open) document.querySelector(`button[data-mu="${key}"]`)?.scrollIntoView({ block: "nearest" });
}

function renderDeck() {
  if (selected == null) { labPick = null; $("deck-detail").innerHTML = `<div class="panel state">Click a deck in the tier list.</div>`; renderChat(); return; }

  const n = D.archetypes.length, a = D.archetypes[selected], r = rating(selected);
  const hideNever = $("hide-never-opp").checked;
  const good = [], bad = [];
  for (let j = 0; j < n; j++) {
    const m = matchup(selected, j);
    if (!m) continue;
    if (hideNever && level(j) === 0) continue;
    const w = weight(j);
    // Sorteerscore (niet getoond): hoe vaak x winrate, en aan de ongunstige kant hoe vaak x verliesrate.
    if (m.p >= 0.5) good.push({ j, o: D.archetypes[j], m, score: w * m.pa });
    else bad.push({ j, o: D.archetypes[j], m, score: w * (1 - m.pa) });
  }
  const byScore = (x, y) => y.score - x.score || y.m.g - x.m.g;
  good.sort(byScore); bad.sort(byScore);
  const t = tierOf(selected);

  const item = ({ j, o, m }) => {
    const lv = level(j), d = m.p - 0.5, width = Math.min(Math.abs(d), 0.5) * 100;
    const bar = d >= 0 ? `left:50%;width:${width}%;background:var(--good)` : `right:50%;width:${width}%;background:var(--bad)`;
    const c = certainty(m.g);
    return `<li class="mu${lv === 0 ? " never" : ""}">
      ${spritesHtml(o, "sm")}
      <div class="mu-main">
        <button class="mu-name" data-deck="${j}">${esc(o.name)}</button>
        <select class="freq-select" data-set="${esc(o.id)}" aria-label="How often do you meet ${esc(o.name)}?">
          ${LEVELS.map(l => `<option value="${l.lv}"${l.lv === lv ? " selected" : ""}>${l.label}</option>`).join("")}</select>
      </div>
      <div class="mu-nums">
        <div class="wr"><span class="val ${d >= 0.02 ? "pos" : d <= -0.02 ? "neg" : ""}">${pct(m.p, 0)}</span><span class="bar"><span style="${bar}"></span></span></div>
        <span class="cert" title="Confidence ${c} of 5" aria-label="Confidence ${c} of 5">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= c ? "on" : ""}"></i>`).join("")}</span>
      </div>
    </li>`;
  };
  // Standaard de top 5; de rest staat er al, maar verborgen tot je uitklapt.
  if (muOpenDeck !== selected) { muOpen = { good: false, bad: false }; muOpenDeck = selected; }
  const col = (title, cls, key, list, empty) => {
    const more = list.length > MU_TOP, open = muOpen[key];
    return `<div class="mu-col ${cls}">
      <h3>${title} <span class="count">${list.length}</span></h3>
      ${list.length ? `<ol class="mu-list${more && !open ? " limited" : ""}" id="mu-${key}">${list.map(item).join("")}</ol>` : `<div class="state">${empty}</div>`}
      ${more ? `<button class="mu-more" data-mu="${key}" aria-controls="mu-${key}" aria-expanded="${open}">${muMoreLabel(open, list.length)}</button>` : ""}
    </div>`;
  };
  exportLists.length = 0;
  const l = L ? labsById.get(a.id) : null;
  const R = l?.ml?.signal ? recommend(l) : null;
  labPick = labListFor(a, l, R);
  const lists = renderDecklist(a, R);

  $("deck-detail").innerHTML = `
    <div class="panel">
      <div class="deck-head">
        ${spritesHtml(a, "lg")}
        <div class="info">
          <h2>${esc(a.name)}</h2>
          <div class="sub deck-sub">${r ? `Expected winrate against My meta <b class="${r.exp >= 0.52 ? "pos" : r.exp <= 0.48 ? "neg" : ""}">${pct(r.exp)}</b>` : "Set the decks you meet in My meta to get an expected winrate"}</div>
          <nav class="deck-links" aria-label="On this page">
            <button type="button" data-jump="#deck-detail .mu-cols">Matchups</button>
            <button type="button" data-jump="#deck-key">Key numbers</button>
            <button type="button" data-jump="#deck-key ~ section.dl">Lists</button>
            <button type="button" data-chatjump>Deck chat</button>
          </nav>
        </div>
        ${t ? `<span class="badge" style="background:var(--tier-${t})" title="Tier ${t}">${t}</span>` : ""}
      </div>
      <div class="mu-cols">
        ${col("Favorable", "is-good", "good", good, "No favorable matchups.")}
        ${col("Unfavorable", "is-bad", "bad", bad, "No unfavorable matchups.")}
      </div>
      <p class="note" style="padding:0 16px 14px">Sorted by what matters most: how often you meet the opponent times your chance to win (left) or lose (right). The dots show confidence: the more games played, the more reliable the percentage.</p>
    </div>
    ${chatOn() ? `<section class="panel ask-block">
      <div><h3>Questions about ${esc(a.name)}?</h3><p class="note">Deck chat knows My meta, the matchups and the lists for this deck.</p></div>
      <button class="btn primary" type="button" data-chatjump>Open Deck chat</button>
    </section>` : ""}
    <section class="panel dl" id="deck-key">
      <div class="dl-head"><h3>Key numbers</h3></div>
      <div class="fact-grid">
        ${factGroup("My meta", [["Chance of a favorable matchup", r ? pct(r.fav, 0) : "–"], ["Expected winrate", r ? pct(r.exp) : "–"]])}
        ${L ? labsStats(labsById.get(a.id), meta.decks[selected].defaultShare.share) : ""}
        ${labQuick(labPick)}
      </div>
    </section>
    ${lists.real}
    ${renderRecommendation(l, R)}
    ${lists.main}`;
  renderChat();
}

// ---------- Regionals: resultaten en decklists ----------
const CORE = 0.9, FLEX = 0.4;
const SECTION_TITLES = ["Pokémon", "Trainer", "Energy"];
const nl = x => Number(x).toLocaleString("en-US");
const times = x => x.toFixed(1) + "×";
const convClass = c => c >= 1.15 ? "up" : c <= 0.85 ? "down" : "";
const convPill = l => `<span class="rp ${convClass(l.conv)}">${times(l.conv)} Day 2</span>`;
const labsTitle = l => `Regionals: ${pct(l.day2, 0)} made Day 2 (average ${pct(L.day2_rate, 0)}), ${nl(l.players)} players`;
const cardOf = k => L.cards[k] || ["Unknown card", "", "", 1];
const cityOf = e => (L.events[e]?.name || "").replace(/^(Regional|International|World) Championship |^Special Event /, "") || "unknown Regional";
const exportLists = [];    // kaartlijsten achter de kopieerknoppen van het huidige deck

// ---------- Deck Lab ----------
// De lijst die het gekozen deck naar Deck Lab stuurt: de aanbevolen lijst, anders de consensuslijst.
let labPick = null;        // {text, label, kind}
let labSel = null;         // index van het deck dat in Deck Lab geladen is (via de deckkeuze daar)

// Opties voor een deckkeuze, gegroepeerd per tier (S tot E) en binnen een tier op kans op gunstige matchup.
// needLists: decks zonder lijst van de Regionals uitschakelen (Deck Lab heeft een lijst nodig).
function deckGroups() {
  const groups = Object.fromEntries([...meta.tiers.map(t => [t.tier, []]), ["none", []]]);
  D.archetypes.forEach((a, i) => {
    if (!isDeck(i)) return;
    const r = rating(i);
    groups[tierOf(i) ?? "none"].push({ a, i, f: r ? r.exp : -1 });
  });
  return Object.entries(groups).filter(([, xs]) => xs.length)
    .map(([t, xs]) => ({ t, xs: xs.sort((x, y) => y.f - x.f || x.a.name.localeCompare(y.a.name)) }));
}
const noList = (a, needLists) => needLists && !labsById.get(a.id)?.lists?.length;
function deckOptions(needLists) {
  return deckGroups().map(({ t, xs }) =>
    `<optgroup label="${t === "none" ? "No tier" : `Tier ${t}`}">${xs.map(({ a, i }) =>
      `<option value="${i}"${noList(a, needLists) ? " disabled" : ""}>${esc(a.name)}</option>`).join("")}</optgroup>`).join("");
}
function renderLabSelect() {
  if (!D) return;
  const sel = $("lab-select");
  sel.innerHTML = `<option value="">Load a deck…</option>` + deckOptions(true);
  sel.value = labSel == null ? "" : String(labSel);
  syncPickBtn(sel);
}

// ---------- Schermvullende deckkiezer ----------
// De <select> blijft verborgen de waarde bewaren; de knop ernaast opent de kiezer.
let pick = null;           // {sel, needLists}
function syncPickBtn(sel) {
  const btn = document.querySelector(`button[data-picker="${sel.id}"]`);
  const o = sel.selectedOptions[0];
  if (btn) btn.textContent = o && o.value !== "" ? o.textContent : btn.dataset.placeholder;
}
function openPicker(sel, needLists, title) {
  if (!D) return;
  pick = { sel, needLists, opener: document.activeElement };
  $("pk-title").textContent = title;
  $("pk-search").value = "";
  renderPicker();
  $("picker").hidden = false;
  document.documentElement.style.overflow = "hidden";
  $("pk-body").scrollTop = 0;
  if (matchMedia("(pointer: fine)").matches) $("pk-search").focus();
  else $("pk-close").focus();
}
function closePicker() {
  if (!pick) return;
  $("picker").hidden = true;
  document.documentElement.style.overflow = "";
  pick.opener?.focus?.();
  pick = null;
}
function renderPicker() {
  const q = $("pk-search").value.trim().toLowerCase();
  const cur = pick.sel.value;
  const groups = deckGroups().map(g => ({ ...g, xs: g.xs.filter(x => !q || x.a.name.toLowerCase().includes(q)) })).filter(g => g.xs.length);
  $("pk-body").innerHTML = groups.length ? `<div class="pk-inner tiers">${groups.map(({ t, xs }) => `
    <div class="tier ${t === "none" ? "tier-none" : `tier-${t}`}">
      <div class="tier-label">${t === "none" ? "–" : t}${t === "none" ? "<small>no tier</small>" : ""}</div>
      <div class="tiles">${xs.map(({ a, i }) => {
        const off = noList(a, pick.needLists);
        return `<button type="button" class="tile${String(i) === cur ? " current" : ""}" data-pick="${i}"${off ? " disabled" : ""}${String(i) === cur ? ' aria-current="true"' : ""}>
          ${spritesHtml(a)}<span class="name">${esc(a.name)}</span>${off ? '<span class="pk-off">no list</span>' : ""}</button>`;
      }).join("")}</div>
    </div>`).join("")}</div>` : `<div class="state">No decks found.</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("button[data-picker]");
  if (b) openPicker($(b.dataset.picker), b.dataset.picker === "lab-select", b.dataset.title);
});
$("picker").addEventListener("click", e => {
  if (e.target.closest("#pk-close")) { closePicker(); return; }
  const t = e.target.closest("button[data-pick]");
  if (!t || t.disabled) return;
  const sel = pick.sel;
  sel.value = t.dataset.pick;
  closePicker();
  syncPickBtn(sel);
  sel.dispatchEvent(new Event("change"));
});
$("pk-search").addEventListener("input", renderPicker);
// Elementen met data-reveal-for="<id>" alleen tonen zolang dat <details> open is
// (Andere keuzes, uitleg bij de consensuslijst, Waarom deze lijst). "toggle" bubbelt niet, dus capture.
document.addEventListener("toggle", e => {
  const id = e.target.id;
  if (!id) return;
  document.querySelectorAll(`[data-reveal-for="${id}"]`).forEach(el => { el.hidden = !e.target.open; });
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && pick) closePicker(); });
const labLabels = new Map(); // index in exportLists -> naam van de lijst in Deck Lab
function labListFor(a, l, R) {
  if (!L || !l || !l.lists.length) return null;
  const kind = R ? "recommended list" : "consensus list";
  return { text: exportText(R ? R.best.x.cards : l.consensus), kind, label: `${a.name} · ${kind} from Matchup Meta` };
}
// Eén groep in het blok Kerncijfers: rijen [label, waarde-HTML], of alleen een tekst als er geen cijfers zijn.
function factGroup(title, rows, foot = "", tip = "") {
  const body = Array.isArray(rows)
    ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
    : `<p class="note">${rows}</p>`;
  return `<div class="fact-group"${tip ? ` title="${esc(tip)}"` : ""}><h4>${title}</h4>${body}${foot ? `<p class="note">${foot}</p>` : ""}</div>`;
}
function labQuick(p) {
  if (!p) return factGroup("Deck Lab", "No list for this deck in the data.");
  const q = DeckLab.quick(p.text);
  return factGroup("Deck Lab", [
    ["Mulligan chance", pct(q.mullP)],
    ["Supporter on turn 1", q.sup1 == null ? "–" : pct(q.sup1, 0)],
    ["First or second", esc(q.verdict || "–")],
  ], `Calculated on the ${esc(p.kind)}.`);
}

// share: het aandeel voor het gekozen continent, zoals in Mijn meta.
function labsStats(l, share) {
  if (!l) return factGroup("Regionals", "Not played at the Regionals in the data.");
  return factGroup("Regionals", [
    ["Share", pct(share)],
    ["Day 2", `${pct(l.day2, 0)} ${convPill(l)}`],
    ["Top cut", `${nl(l.topcut)}×`],
    L.settings?.top ? ["Avg. finish", `±${ord(Math.round(1 + (1 - l.pct) * (L.settings.top - 1)))}`] : ["Avg. finish", `top ${pct(1 - l.pct, 0)}`],
    ["Players", nl(l.players)],
  ], "", labsTitle(l));
}

function cardRow(k, n, u, R) {
  const [name, set, num] = cardOf(k);
  const incl = u ? u[1] : null;
  const [cls, label] = incl == null ? ["tech", "–"] : incl >= CORE ? ["core", "Core"] : incl >= FLEX ? ["flex", "Flex"] : ["tech", "Tech"];
  // Markering als het model een duidelijk effect ziet (minstens 2 standaardfouten van 0) tegen jouw meta.
  const ef = R?.effects.get(k);
  const mark = ef && Math.abs(ef.e) >= 2 * ef.se
    ? `<span class="mk ${ef.e > 0 ? "up" : "down"}" title="Each extra copy: ${ppTxt(ef.e)} win chance against My meta (± ${ppTxt(ef.se).slice(1)})">${ef.e > 0 ? "▲" : "▼"}</span>` : "";
  return `<li class="card"><span class="n">${n}</span>
    <span class="cn">${esc(name)}${mark}<span class="set">${esc(set)} ${esc(num)}</span></span>
    <span class="inc" title="In ${incl == null ? "less than 3%" : pct(incl, 0)} of lists">${incl == null ? "–" : pct(incl, 0)}</span>
    <span class="tag ${cls}">${label}</span></li>`;
}

function bySection(cards, row) {
  return SECTION_TITLES.map((title, s) => {
    const rows = cards.filter(([k]) => cardOf(k)[3] === s);
    if (!rows.length) return "";
    return `<div class="sec-title">${title} (${rows.reduce((t, [, c]) => t + c, 0)})</div><ul class="cards">${rows.map(row).join("")}</ul>`;
  }).join("");
}

// Tekstformaat zoals Limitless en PTCG Live het gebruiken.
function exportText(cards) {
  const out = [];
  SECTION_TITLES.forEach((title, s) => {
    const rows = cards.filter(([k]) => cardOf(k)[3] === s);
    if (!rows.length) return;
    out.push(`${title}: ${rows.reduce((t, [, c]) => t + c, 0)}`);
    rows.forEach(([k, c]) => { const [name, set, num] = cardOf(k); out.push(`${c} ${name} ${set} ${num}`); });
    out.push("");
  });
  out.push(`Total Cards: ${cards.reduce((t, [, c]) => t + c, 0)}`);
  return out.join("\n");
}

const miniRow = ([k, c]) => `<li>${c} ${esc(cardOf(k)[0])}<span class="set">${esc(cardOf(k)[1])} ${esc(cardOf(k)[2])}</span></li>`;
// label = naam van de lijst in Deck Lab; zonder label geen Deck Lab-knop.
function exportBtn(cards, primary, label) {
  exportLists.push(cards);
  const k = exportLists.length - 1;
  if (label) labLabels.set(k, label);
  return `<div class="upload-row"><button class="btn${primary ? " primary" : ""}" data-export="${k}">Copy for PTCG Live</button>${label ? `<button class="btn" type="button" data-lab="${k}">Open in Deck Lab</button>` : ""}<span class="hint copy-state"></span></div>`;
}

// ---------- Aanbevolen lijst (model uit labs_ml.py) ----------
const sigm = x => 1 / (1 + Math.exp(-x));
const ppTxt = x => (x < 0 ? "−" : "+") + Math.abs(x * 100).toFixed(1) + " pp";
const certFromZ = z => z >= 6 ? 5 : z >= 4 ? 4 : z >= 3 ? 3 : z >= 2 ? 2 : 1;

// Weeg het model met jouw "hoe vaak" (Worldwide, dus los van het continent) en kies de Day 2-lijst met de hoogste ondergrens
// (verwacht voordeel min 1 standaardfout), zodat ongewone lijsten met veel onzekerheid niet winnen.
function recommend(l) {
  const M = l.ml;
  const w = new Map();
  let tot = 0;
  D.archetypes.forEach((o, j) => {
    const x = listMeta.decks[j].weight;
    if (!x) return;
    const c = o.id in M.opps ? o.id : "overig";
    w.set(c, (w.get(c) || 0) + x);
    tot += x;
  });
  if (!tot || !M.cands.length) return null;
  const cats = [...w.entries()].map(([c, x]) => ({ base: M.base + (M.opps[c] ?? M.opps.overig ?? 0), share: x / tot, k: M.inter.indexOf(c) }));
  const avg = cats.reduce((s, c) => s + c.share * sigm(c.base), 0);
  let best = null;
  for (const x of M.cands) {
    const p = cats.reduce((s, c) => s + c.share * sigm(c.base + x.d + (c.k >= 0 ? x.di[c.k] : 0)), 0);
    if (!best || p - avg - x.se > best.up - best.x.se) best = { x, up: p - avg };
  }
  // Effect per extra kopie tegen jouw meta, met een benaderde standaardfout.
  const sh = M.inter.map(c => (w.get(c) || 0) / tot);
  const slope = avg * (1 - avg);
  const effects = new Map(M.cards.map(([k, b, se, mean, g, gse]) => [k, {
    mean,
    e: (b + g.reduce((s, v, j) => s + sh[j] * v, 0)) * slope,
    se: Math.sqrt(se * se + gse.reduce((s, v, j) => s + (sh[j] * v) ** 2, 0)) * slope,
  }]));
  return { best, avg, effects };
}

// De kaartkeuzes die het meest bijdragen aan het voordeel van de aanbevolen lijst (5 positief, 2 negatief).
function recWhy(l, R) {
  const counts = new Map(R.best.x.cards);
  const contrib = l.ml.cards.map(([k]) => {
    const ef = R.effects.get(k), n = counts.get(k) || 0;
    return { k, n, mean: ef.mean, v: (n - ef.mean) * ef.e };
  }).filter(r => Math.abs(r.v) >= 0.002);
  return [...contrib.filter(r => r.v > 0).sort((p, q) => q.v - p.v).slice(0, 5),
          ...contrib.filter(r => r.v < 0).sort((p, q) => p.v - q.v).slice(0, 2)];
}
// Pokémon met dezelfde naam kunnen verschillende kaarten zijn, dus daar set en nummer bij.
const cardLabel = k => cardOf(k)[3] === 0 ? `${cardOf(k)[0]} (${cardOf(k)[1]} ${cardOf(k)[2]})` : cardOf(k)[0];
const fmt1 = x => x.toFixed(1);

function renderRecommendation(l, R) {
  if (!l) return "";
  const wrap = (body, side = "") => `<section class="panel dl rec"><div class="dl-head"><h3>Recommended list for My meta</h3>${side}</div>${body}</section>`;
  if (!l.ml) return wrap(`<div class="note">Too few lists (${nl(l.lists_n)}, at least ${nl(L.settings?.min_lists || 300)} needed) to pick a reliable Recommended list. Use the Consensus list below.</div>`);
  if (!l.ml.signal) return wrap(`<div class="note">For this deck the card choices in the data make no measurable difference (yet): the model does not predict clearly better with them than without, on Regionals it did not see or on later Regionals when it learns only from earlier ones. The Consensus list below is a fine choice.</div>`);
  if (!R) return wrap(`<div class="note">First set the decks you meet in <a href="#meta" data-goto="meta">My meta</a>.</div>`);
  const { x, up } = R.best;
  const c = certFromZ(l.ml.z_fwd ?? l.ml.z);
  const cert = `<span class="cert" title="Confidence ${c} of 5: how clearly the card choices for this deck predict the result at a later Regional" aria-label="Confidence ${c} of 5">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= c ? "on" : ""}"></i>`).join("")}</span>`;
  const why = recWhy(l, R);
  const whyRow = r => `<li><span class="n">${r.n}×</span>
    <span class="cn">${esc(cardOf(r.k)[0])}<span class="set">${cardOf(r.k)[3] === 0 ? `${esc(cardOf(r.k)[1])} ${esc(cardOf(r.k)[2])} · ` : ""}avg. ${r.mean.toFixed(1)}×</span></span>
    <span class="${r.v > 0 ? "pos" : "neg"}">${ppTxt(r.v)}</span></li>`;
  return wrap(`
    <div class="rec-grid">
      <div>
        <p class="rec-src">${ord(x.place)} of ${nl(x.of)} · ${esc(cityOf(x.e))} · ${esc(x.rec)}${x.top ? '<span class="tag core">Top cut</span>' : '<span class="tag flex">Day 2</span>'}${x.n > 1 ? ` · played exactly like this by ${x.n} players` : ""}</p>
        <p class="rec-num">Expected edge against My meta: <b class="${up >= 0 ? "pos" : "neg"}">${ppTxt(up)}</b> win chance over an average ${esc(l.name)} list <span class="hint">(between ${ppTxt(up - x.se)} and ${ppTxt(up + x.se)})</span></p>
      </div>
      <div>
        <details class="list" id="rec-details"><summary>View the list</summary><div class="mini">${bySection(x.cards, miniRow)}</div></details>
        <div data-reveal-for="rec-details" hidden>
          <h4 class="dl-sub">Why this list</h4>
          ${why.length ? `<ul class="why">${why.map(whyRow).join("")}</ul>` : `<div class="note">No card choice stands out.</div>`}
        </div>
        <div style="margin-top:8px">${exportBtn(x.cards, true, `${l.name} · recommended list from Matchup Meta`)}</div>
      </div>
    </div>
    <p class="note">Picked from ${nl(l.ml.cands.length)} different Day 2 lists with a model trained on ${nl(l.ml.games)} games. It was tested on Regionals it did not see, and on later Regionals while learning only from earlier ones. The edge is an estimate: the best of hundreds of lists often does a little worse in practice, and part of it may come from strong players making these choices. pp = percentage points.</p>`, cert);
}

// Twee blokken: de echte lijsten (boven de aanbevolen lijst) en consensus met andere keuzes (eronder).
function renderDecklist(a, R) {
  const head = `<div class="dl-head"><h3>Consensus list</h3>`;
  if (!L) return { real: "", main: `<section class="panel dl">${head}</div><div class="note">No Regionals data loaded.</div></section>` };
  const l = labsById.get(a.id);
  if (!l || !l.lists.length) return { real: "", main: `<section class="panel dl">${head}</div><div class="note">There are no Regionals lists for this deck.</div></section>` };
  const use = new Map(l.usage.map(u => [u[0], u]));
  const inList = new Set(l.consensus.map(([k]) => k));
  const others = l.usage.filter(u => !inList.has(u[0])).slice(0, 15);
  const lists = l.lists.map(x => `<details class="list">
      <summary>${x.place ? `${ord(x.place)} of ${nl(x.of)}` : "No finish"} · ${esc(cityOf(x.e))} · ${esc(x.rec)}${x.top ? '<span class="tag core">Top cut</span>' : x.day2 ? '<span class="tag flex">Day 2</span>' : ""}${x.typical ? '<span class="tag typical">Most typical</span>' : ""}</summary>
      <div class="mini">${bySection(x.cards, miniRow)}</div>
      ${exportBtn(x.cards, false, `${a.name} · ${x.place ? `${ord(x.place)} of ${x.of}` : "list"} in ${cityOf(x.e)}`)}
    </details>`).join("");
  const real = `<section class="panel dl">
    <div class="dl-head"><h3>Played lists</h3><span class="note">The best-finishing lists from the Regionals, plus the Day 2 list closest to the consensus (most typical).</span></div>
    <div class="lists">${lists}</div>
  </section>`;
  const legend = `Core: in 90% or more of lists · Flex: 40 to 90% · Tech: under 40%${R ? " · ▲▼ clear effect per extra copy against My meta" : ""}`;
  const main = `<section class="panel dl">
    ${head}<span class="note" data-reveal-for="cons-details" hidden>${nl(l.lists_n)} lists from ${L.events.length} Regionals · ${legend}</span></div>
    <details class="list" id="cons-details"><summary>View the list</summary>${bySection(l.consensus, ([k, c]) => cardRow(k, c, use.get(k), R))}</details>
    <div>${exportBtn(l.consensus, true, `${a.name} · consensus list from Matchup Meta`)}</div>
    <p class="note">The Consensus list is the average of all lists, with recent Regionals counting more, and may never have been played exactly like this. Open the list to see the other choices too.</p>
  </section>
  <section class="panel dl" data-reveal-for="cons-details" hidden>
    <div class="dl-head"><h3>Other choices</h3><span class="note">Cards not in the Consensus list but in 3% or more of lists, with the most-played count · ${legend}</span></div>
    ${others.length ? `<ul class="cards">${others.map(u => cardRow(u[0], u[2], u, R)).join("")}</ul>` : `<div class="note">No other cards in 3% or more of lists.</div>`}
  </section>`;
  return { real, main };
}

// Kopiëren naar het klembord; lukt dat niet, dan de tekst geselecteerd tonen.
function copyText(text, stateEl, onFail) {
  const fail = () => { stateEl.textContent = "Could not copy automatically. Select the text and press Ctrl+C."; onFail(); };
  try { navigator.clipboard.writeText(text).then(() => { stateEl.textContent = "Copied."; }, fail); } catch { fail(); }
}
function copyExport(btn) {
  const text = exportText(exportLists[Number(btn.dataset.export)] || []);
  const row = btn.parentElement;
  copyText(text, row.querySelector(".copy-state"), () => {
    let t = row.nextElementSibling;
    if (!t?.matches("textarea.copy-fallback")) {
      t = document.createElement("textarea");
      t.className = "copy-fallback"; t.rows = 10; t.readOnly = true;
      row.after(t);
    }
    t.value = text; t.select();
  });
}

// ---------- Navigatie ----------
// Twee tabs; het deck en My meta zijn pagina's zonder tab, bereikbaar via de hash.
// Ask Claude is een dialog (#dialog-advice) over de pagina.
const TABS = ["tierlist", "lab"];
const PAGES = [...TABS, "deck", "meta"];
let current = "tierlist";
function show(page) {
  if (!PAGES.includes(page)) page = "tierlist";
  current = page;
  PAGES.forEach(p => { $("page-" + p).hidden = p !== page; });
  TABS.forEach(t => $("tab-" + t).setAttribute("aria-selected", String(t === page)));
  if (TABS.includes(page)) storage.write("matchup-meta-tab", page);
  renderCurrent();
}
// Een dialog openen op naam (#dialog-<naam>); sluiten gaat met × of Esc, de focus gaat terug.
const openDialog = name => { const d = $("dialog-" + name); if (!d?.open) d?.showModal(); };
// De hash bepaalt de pagina: #deck/<deck id>, #lab, #meta; zonder hash de onthouden tab.
// Een hash met een dialog (oude bladwijzer #advice) opent die over de tier list.
// Een onbekend deck of een onbekende hash geeft de tier list.
function route() {
  let h;
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { h = ""; }
  if (h && $("dialog-" + h)) {
    history.replaceState(null, "", "#tierlist");
    show("tierlist"); openDialog(h);
    return;
  }
  if (h.split("/")[0] === "deck") {
    if (!D) return; // start() routeert opnieuw als de data er is
    const i = D.archetypes.findIndex(a => a.id === h.slice(5));
    if (i < 0) return show("tierlist");
    selected = i; show("deck"); window.scrollTo({ top: 0 });
    return;
  }
  const tab = storage.read("matchup-meta-tab");
  show(h || (TABS.includes(tab) ? tab : "tierlist"));
}
// Naar een hash, meteen getoond. pushState geeft geen hashchange; terug en vooruit wel.
function go(h) {
  if (location.hash !== "#" + h) history.pushState(null, "", "#" + h);
  route();
}
addEventListener("hashchange", route);
function renderCurrent() {
  if (current === "lab") { DeckLab.mount($("lab-host")); if (D) { recompute(); renderLabSelect(); } return; }
  if (!D) return;
  recompute();
  if (current === "tierlist") renderTiers();
  else if (current === "meta") renderMeta();
  else if (current === "deck") renderDeck();
  renderAdvice(); // de dialog kan over elke pagina open zijn
}
const renderAll = renderCurrent;
const openDeck = i => go("deck/" + encodeURIComponent(D.archetypes[i].id));

document.querySelector("nav.tabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-tab]");
  if (b) go(b.dataset.tab);
});
document.addEventListener("click", e => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); $("dialog-" + g.dataset.goto) ? openDialog(g.dataset.goto) : go(g.dataset.goto); return; }
  const jb = e.target.closest("button[data-jump]");
  if (jb) { document.querySelector(jb.dataset.jump)?.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
  const x = e.target.closest("button[data-export]");
  if (x) { copyExport(x); return; }
  const lb = e.target.closest("button[data-lab]");
  if (lb) {
    const k = Number(lb.dataset.lab);
    labSel = current === "deck" ? selected : null;
    DeckLab.open($("lab-host"), exportText(exportLists[k] || []), labLabels.get(k) || "List from Matchup Meta");
    go("lab"); window.scrollTo({ top: 0 });
    return;
  }
  if (e.target.closest("button[data-chatjump]")) { $("deck-chat").scrollIntoView({ block: "start", behavior: "smooth" }); setTimeout(() => $("chat-input")?.focus({ preventScroll: true }), 400); return; }
  const mu = e.target.closest("button[data-mu]");
  if (mu) { toggleMu(mu.dataset.mu); return; }
  const d = e.target.closest("[data-deck]");
  if (d) { openDeck(Number(d.dataset.deck)); return; }
  const s = e.target.closest("button[data-set]");
  if (s) setLevel(s.dataset.set, Number(s.dataset.w));
});
document.addEventListener("change", e => {
  if (e.target.matches("select[data-set]")) setLevel(e.target.dataset.set, Number(e.target.value));
});
$("lab-select").addEventListener("change", e => {
  if (e.target.value === "") return;
  const i = Number(e.target.value), a = D.archetypes[i], l = labsById.get(a.id);
  const p = labListFor(a, l, l?.ml?.signal ? recommend(l) : null);
  if (!p) return;
  labSel = i;
  DeckLab.open($("lab-host"), p.text, p.label);
});
["show-never", "only-changed", "hide-never-opp"].forEach(id => $(id).addEventListener("change", renderCurrent));
$("meta-search").addEventListener("input", renderMeta);
let resetArmed = false;
$("reset").addEventListener("click", e => {
  if (!Object.keys(localFrequencies).length) return;
  if (!resetArmed) {
    resetArmed = true; e.target.textContent = "Click again to reset"; e.target.classList.add("danger-confirm");
    setTimeout(() => { resetArmed = false; e.target.textContent = "Reset all to default"; e.target.classList.remove("danger-confirm"); }, 3000);
    return;
  }
  resetArmed = false; e.target.textContent = "Reset all to default"; e.target.classList.remove("danger-confirm");
  localFrequencies = {}; saveSettings(); renderAll();
});

// Settings naar een bestand en terug; een ongeldig bestand verandert niets.
const importState = msg => { $("import-state").textContent = msg; $("import-state").hidden = !msg; };
$("export-settings").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([exportSettings({ localFrequencies, continent })], { type: "application/json" }));
  a.download = "matchup-meta-settings.json";
  a.click();
  URL.revokeObjectURL(a.href);
  importState("");
});
$("import-settings").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const r = importSettings(await file.text());
  if (!r.ok) return importState(`Not imported, your settings are unchanged. ${r.error}`);
  ({ localFrequencies, continent } = r.settings);
  $("continent").value = continent;
  saveSettings(); renderAll();
  importState(`Settings imported from ${file.name}.`);
});

// ---------- Start ----------
$("weight-legend").innerHTML = "Weight in the calculation: " + LEVELS.map(l => `<span><b>${l.label}</b> ${l.w}</span>`).join("");

// "2026-10-16" of "2026-10-16T15:04" -> "16 Oct 2026". Alleen de datum telt, dus in UTC om geen dag te verschuiven.
const fmtDate = s => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return Number.isNaN(t) ? String(s) : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// Zet een (nieuwe) dataset in gebruik.
function applyData(json, origin) {
  const prevId = selected == null ? null : D?.archetypes[selected]?.id;
  D = json;
  D.origin = origin;
  const idx = D.archetypes.findIndex(a => a.id === prevId);
  selected = idx >= 0 ? idx : null;
  renderSource();
  renderCurrent();
}

// Footer op elke tab: wanneer elke databron is bijgewerkt en welk seizoen de Regionals dekken.
function renderFooter() {
  const parts = [D?.generated ? `Matchups updated ${fmtDate(D.generated)}` : "Matchups not loaded"];
  parts.push(L?.generated ? `Regionals updated ${fmtDate(L.generated)}` : "Regionals not loaded");
  // Seizoen 2027 loopt vanaf 1 augustus 2026.
  const season = Number(L?.season);
  if (season) parts.push(`Season ${season} (from 1 Aug ${season - 1})`);
  $("foot-updated").textContent = parts.join(" · ");
}

// Periode van de bronnen, in de footer.
function renderSource() {
  if (!D) return;
  const f = D.filters;
  let s = `Matchups: Trainerhill, tournaments with ${f.players}+ players, ${fmtDate(f.start_date)} to ${fmtDate(f.end_date)}`;
  if (L) s += ` · Results and lists: ${L.events.length} Regionals (Limitless Labs${L.settings?.top ? `, top ${L.settings.top}` : ""})`;
  $("foot-period").textContent = s;
  renderFooter();
}

// Zet (nieuwe) Regionals-data in gebruik.
function applyLabs(json, origin) {
  L = json;
  L.origin = origin;
  labsById = new Map(L.archetypes.map(a => [a.id, a]));
  renderSource();
  renderCurrent();
}

function isLabs(j) {
  const nc = Array.isArray(j?.cards) ? j.cards.length : 0;
  const cardsOk = list => Array.isArray(list) && list.every(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < nc && Number.isFinite(x[1]));
  return j && Array.isArray(j.events) && Array.isArray(j.archetypes) && typeof j.day2_rate === "number" && j.day2_rate > 0
    && Array.isArray(j.cards) && j.cards.every(c => Array.isArray(c) && c.length === 4 && typeof c[0] === "string" && [0, 1, 2].includes(c[3]))
    && j.archetypes.every(a => a && typeof a.id === "string" && typeof a.share === "number" && typeof a.conv === "number"
      && typeof a.day2 === "number" && typeof a.pct === "number" && cardsOk(a.usage) && cardsOk(a.consensus)
      && (!a.ml || (typeof a.ml.signal === "boolean" && typeof a.ml.z === "number" && typeof a.ml.base === "number"
        && (a.ml.z_fwd == null || typeof a.ml.z_fwd === "number")
        && a.ml.opps && typeof a.ml.opps === "object" && Array.isArray(a.ml.inter) && Array.isArray(a.ml.cands)
        && Array.isArray(a.ml.cards) && a.ml.cards.every(c => Array.isArray(c) && Number.isInteger(c[0]) && c[0] >= 0 && c[0] < nc
          && Array.isArray(c[4]) && Array.isArray(c[5]) && c[4].length === a.ml.inter.length)
        && a.ml.cands.every(x => x && Number.isFinite(x.d) && Number.isFinite(x.se) && Array.isArray(x.di)
          && x.di.length === a.ml.inter.length && cardsOk(x.cards))))
      && Array.isArray(a.lists) && a.lists.every(x => x && cardsOk(x.cards))
      && Array.isArray(a.counts) && a.counts.length === j.events.length && a.counts.every(Number.isFinite))
    && j.events.every(e => e && Number.isFinite(e.players) && Number.isFinite(e.recency));
}

// ---------- Advies (Claude, met de eigen API key) ----------
let adviceHistory = [];    // eerdere Advice, nieuwste eerst; blijft in de browser (storage.js)
let advice = null;         // getoonde Advice: {result, createdAt, context, dataGenerated, labsGenerated}
let adviceCtl = null;

// Regels over de Regionals voor één kandidaat: resultaten, aanbevolen lijst en kaarten met duidelijk effect.
function labsPromptLines(a) {
  if (!L) return [];
  const l = labsById.get(a.id);
  if (!l) return ["Regionals: not played at the Regionals in the data"];
  const out = [`Regionals: share ${pct(l.share)} · Day 2 ${pct(l.day2, 0)} (${times(l.conv)} the average, ${l.players} players) · ${l.topcut} top cuts · average finish top ${pct(1 - l.pct, 0)}`];
  if (!l.lists.length) return out;
  if (!l.ml) return [...out, "List: too few lists for the model; only the consensus list."];
  if (!l.ml.signal) return [...out, "List: card choices make no measurable difference for this deck; the consensus list is fine."];
  const R = recommend(l);
  if (!R) return out;
  const { x, up } = R.best;
  out.push(`Recommended list for this meta: ${ord(x.place)} of ${x.of} in ${cityOf(x.e)} (${x.rec}), ${ppTxt(up)} chance to win over an average list (± ${ppTxt(x.se).slice(1)})`);
  const why = recWhy(l, R);
  if (why.length) out.push(`  Main choices: ${why.map(w => `${w.n}× ${cardLabel(w.k)} (avg. ${fmt1(w.mean)}) ${ppTxt(w.v)}`).join(" · ")}`);
  const clear = [...R.effects].filter(([, e]) => Math.abs(e.e) >= 2 * e.se).sort((p, q) => q[1].e - p[1].e);
  if (clear.length) out.push(`Cards with a clear effect per extra copy: ${clear.map(([k, e]) => `${cardLabel(k)} ${ppTxt(e.e)}`).join(" · ")}`);
  return out;
}

function buildAdvicePrompt(context) {
  const opps = D.archetypes.map((a, j) => ({ a, j, lv: level(j) })).filter(x => x.lv > 0)
    .sort((x, y) => y.lv - x.lv || y.a.share - x.a.share);
  // Alleen decks met genoeg games tegen jouw meta zijn serieuze kandidaten.
  const gamesVsMeta = i => opps.reduce((s, { j }) => s + (matchup(i, j)?.g || 0), 0);
  const all = D.archetypes.map((a, i) => ({ a, i, r: rating(i), g: gamesVsMeta(i) }))
    .filter(x => x.r && isDeck(x.i));
  const cands = all.filter(x => x.g >= 150).sort((x, y) => y.r.exp - x.r.exp).slice(0, 25);
  // Plus maximaal 5 decks die het op de Regionals duidelijk beter doen dan gemiddeld, maar niet in de top 25 staan.
  const inCands = new Set(cands.map(x => x.i));
  const labsOf = x => labsById.get(x.a.id);
  const extra = L ? all.filter(x => !inCands.has(x.i) && labsOf(x)?.players >= 200 && labsOf(x).conv >= 1.15)
    .sort((x, y) => labsOf(y).conv - labsOf(x).conv).slice(0, 5) : [];

  const metaLines = opps.map(({ a, lv }) => `- ${a.name} [${a.id}]: ${LABEL[lv]} (weight ${WEIGHT[lv]}; share in tournament data ${pct(a.share)})`).join("\n");
  const block = ({ a, i, r, g }) => {
    const mus = opps.map(({ a: o, j }) => {
      const m = matchup(i, j);
      return m ? `${o.name}: ${pct(m.p, 0)} (certainty ${certainty(m.g)}/5)` : null;
    }).filter(Boolean);
    return [`### ${a.name} [${a.id}]`,
      `tier ${tierOf(i)} · chance of a favorable matchup ${pct(r.fav, 0)} · expected winrate ${pct(r.exp)} · ${g} games against this meta · share in tournament data ${pct(a.share)} · the player meets it: ${LABEL[level(i)]}`,
      ...labsPromptLines(a),
      `Matchups: ${mus.join("; ")}`].join("\n");
  };
  const labsInfo = L ? `
- Regionals: Limitless Labs, ${L.events.length} Regionals this season (${L.events.map((e, k) => cityOf(k)).join(", ")}), Masters only${L.settings?.top ? `, only the top ${L.settings.top} of each Regional (Day 2 rates and finishes are within that group)` : ""}, ${nl(L.events.reduce((t, e) => t + e.players, 0))} players. Recent events count more.
- "Day 2" = the share of players with this deck who made Day 2; "1.3× the average" = 30% more often than average. It shows how the deck does in practice, but partly also who plays it (strong players often pick strong decks).
- "Recommended list" = a real Day 2 list that a statistical model rates highest against this meta, compared with an average list of the same deck. "Main choices" = the card counts where that list differs from the average and what the model says that is worth (pp = percentage points of chance to win). The model was tested on Regionals it did not see and on later Regionals while learning only from earlier ones, but the estimate is uncertain and often a little optimistic.` : "";
  const listTask = L ? `
Besides the matchups, weigh how the deck does in practice at the Regionals; if the two disagree, say so. For each deck you advise, choose a list in "list": "recommended" (if there is one) or "consensus" (the average of all lists), for example when the player's extra context asks for it. In "cards" give at most 3 concrete card tips, only with cards listed for that deck above, with the name written exactly as there; leave "cards" empty if there is nothing useful to say.` : "";

  return `You are an experienced Pokémon TCG player and coach. Advise which deck this player should play at their local tournaments (locals)${L ? ", and with which list" : ""}. Write in English, short and concrete.

## How the data works
- Matchup source: Trainerhill, tournaments with ${D.filters.players}+ players from ${D.filters.start_date} to ${D.filters.end_date}. These are bigger tournaments; locals can differ.
- Winrate per matchup: (wins + ties/3) / games. Certainty 1-5 depends on the number of games played (1 = fewer than 20 games, 5 = 400 or more).
- "Meets it" is the player's own estimate for their locals. Weights: ${LEVELS.map(l => `${l.label} ${l.w}`).join(", ")}.
- "Chance of a favorable matchup" = weighted share of matchups of 55%+ (45% or less counts as 0, in between pro rata), with small samples pulled towards 50%. "Expected winrate" = weighted average winrate.${labsInfo}

## The player's meta (how often they meet each deck)
${metaLines || "(no decks set)"}

## Candidates (top 25 by expected winrate, only decks with 150+ games against this meta; a missing matchup was never played and counts as 50%)
${cands.map(block).join("\n\n")}
${extra.length ? `
## Extra candidates: strong at the Regionals (Day 2 at least 1.15× the average, 200+ players), but not in the top 25 by matchups
${extra.map(block).join("\n\n")}
` : ""}
## The player's extra context
${context || "(none)"}

## What to do
Weigh mainly the expected winrate against their meta (the tiers are based on it) and how often they get a favorable matchup, but also watch: bad matchups against decks they meet often (those are the most dangerous), reliability (low certainty = careful), and the extra context. Do not make up cards, decklists or facts that are not in this data.${listTask}

Answer in the given JSON format. "summary": 2-3 sentences with your conclusion. "picks": exactly 1 with role "Best pick" and 2 with role "Alternative", each with "why" in 2-3 sentences, "strong_against" as deck names, "watch_out" as short warnings and "confidence" high, medium or low. "avoid": at most 3 decks that look good but are risky, or popular but bad in this meta, each with "why" in 1 sentence. "caveats": at most 3 short caveats about the data or your advice. For deck_id use only ids between [ ] in the lists above.`;
}

// Vorm van het gestructureerde antwoord (structured outputs); "list" en "cards" alleen met Regionals-data.
function adviceSchema(withLists) {
  const str = { type: "string" }, strs = { type: "array", items: str };
  const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const pick = {
    deck_id: str, role: { type: "string", enum: ["Best pick", "Alternative"] }, why: str,
    strong_against: strs, watch_out: strs, confidence: { type: "string", enum: ["high", "medium", "low"] },
  };
  if (withLists) Object.assign(pick, {
    list: { type: "string", enum: ["recommended", "consensus"] },
    cards: { type: "array", items: obj({ card: str, tip: str }) },
  });
  return obj({ summary: str, picks: { type: "array", items: obj(pick) }, avoid: { type: "array", items: obj({ deck_id: str, why: str }) }, caveats: strs });
}

// Codes uit ai.js -> wat de bezoeker kan doen.
const ADVICE_ERRORS = {
  invalid_key: "Anthropic rejected your API key. Check that you pasted all of it, or remove it and enter a new one.",
  browser_blocked: "Your Anthropic organization does not allow calls from a browser (for example with zero data retention). Use a key from another organization.",
  billing: "Your Anthropic account has no credit left. Add credit in the Claude Console and try again.",
  forbidden: "Your API key is not allowed to do this. Check its permissions in the Claude Console.",
  model_unavailable: "The Claude model for Advice is not available with your API key.",
  too_large: "There is too much data to send. Set a few decks to Never and try again.",
  rate_limited: "Too many requests at once. Wait a minute and try again.",
  overloaded: "Claude is busy right now. Try again in a few minutes.",
  server: "Anthropic could not answer right now. Try again later.",
  network: "Could not reach Anthropic. Check your connection and try again.",
  refused: "Claude declined to answer. Change the extra context and try again.",
  truncated: "Claude's answer was cut off. Try again.",
  invalid_json: "Claude answered in an unexpected format. Try again.",
};

async function runAdvice() {
  if (!apiKey || !D) return;
  const context = $("advice-context").value.trim().slice(0, 2000);
  const run = $("advice-run"), stop = $("advice-stop"), state = $("advice-state");
  run.disabled = true; stop.hidden = false;
  const t0 = Date.now();
  const tick = setInterval(() => { state.textContent = `Analyzing My meta… ${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  state.textContent = "Analyzing My meta…"; state.className = "hint";
  adviceCtl = new AbortController();
  try {
    const result = await createAI(apiKey).json(buildAdvicePrompt(context), adviceSchema(!!L), { signal: adviceCtl.signal });
    if (!result || !Array.isArray(result.picks)) throw { code: "invalid_json" };
    advice = { result, createdAt: new Date().toISOString(), context, dataGenerated: D.generated || null, labsGenerated: L?.generated || null };
    adviceHistory = [advice, ...adviceHistory];
    storage.saveAdviceHistory(adviceHistory);
    state.textContent = "";
    renderAdvice();
  } catch (e) {
    state.textContent = e?.code === "cancelled" ? "Stopped." : (ADVICE_ERRORS[e?.code] || "Could not get Advice. Try again later.");
    state.className = e?.code === "cancelled" ? "hint" : "hint err";
  } finally {
    clearInterval(tick);
    stop.hidden = true; adviceCtl = null;
    run.disabled = !apiKey;
  }
}
$("advice-run").addEventListener("click", runAdvice);
$("advice-stop").addEventListener("click", () => adviceCtl?.abort());
$("advice-result").addEventListener("change", e => {
  if (e.target.id !== "advice-history") return;
  advice = adviceHistory[Number(e.target.value)] || advice;
  renderAdvice();
});

// De key staat alleen in deze browser en gaat alleen naar Anthropic. Weghalen is één klik.
function renderKey() {
  $("key-off").hidden = !!apiKey;
  $("key-on").hidden = !apiKey;
  $("key-on-text").textContent = apiKey ? `Advice and Deck chat use your Anthropic API key ending in …${apiKey.slice(-4)}. It is stored only in this browser.` : "";
}
$("key-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("key-input"), key = input.value.trim(), state = $("key-state");
  if (!key || /\s/.test(key)) { state.textContent = "Paste your whole API key, without spaces."; state.className = "hint err"; return; }
  apiKey = key;
  input.value = "";
  const saved = storage.saveApiKey(key);
  state.textContent = saved ? "" : "Could not save the key in this browser; it only applies to this visit.";
  state.className = "hint";
  chatSig = ""; renderKey(); renderCurrent();
});
$("key-remove").addEventListener("click", () => {
  adviceCtl?.abort();
  chatRun?.ctl.abort();
  storage.removeApiKey();
  apiKey = null;
  $("key-state").textContent = "Key removed from this browser.";
  $("key-state").className = "hint";
  chatSig = ""; renderKey(); renderCurrent();
});

// Regionals-cijfers en de lijst bij een advieskaart. Kaarttips worden alleen getoond als de kaart
// echt bij dat deck in de data voorkomt, zodat verzonnen kaarten niet in beeld komen.
const norm = s => String(s).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
function adviceRegionals(a) {
  const l = L && labsById.get(a.id);
  return l ? `<div class="nums"><span>Regionals: Day 2 <b>${pct(l.day2, 0)}</b> ${convPill(l)}</span><span>Share <b>${pct(l.share)}</b></span></div>` : "";
}
function adviceList(a, p) {
  const l = L && labsById.get(a.id);
  if (!l || !l.lists.length) return "";
  const R = l.ml?.signal ? recommend(l) : null;
  const rec = R && p.list !== "consensus";
  const cards = rec ? R.best.x.cards : l.consensus;
  const x = rec ? R.best.x : null;
  const title = rec
    ? `Recommended list: ${ord(x.place)} of ${nl(x.of)} in ${esc(cityOf(x.e))} (${esc(x.rec)}), ${ppTxt(R.best.up)} over an average list`
    : `Consensus list: the average of ${nl(l.lists_n)} lists`;
  const names = new Set();
  const add = k => { names.add(norm(cardOf(k)[0])); names.add(norm(cardLabel(k))); };
  l.usage.forEach(u => add(u[0]));
  l.consensus.forEach(([k]) => add(k));
  (l.ml?.cards || []).forEach(c => add(c[0]));
  const tips = (Array.isArray(p.cards) ? p.cards : [])
    .filter(t => t && typeof t.card === "string" && typeof t.tip === "string" && names.has(norm(t.card))).slice(0, 3);
  return `<h4>List</h4>
    <details class="list"><summary>${title}</summary><div class="mini">${bySection(cards, miniRow)}</div></details>
    ${exportBtn(cards, false, `${a.name} · ${rec ? "recommended list" : "consensus list"} from Matchup Meta`)}
    ${tips.length ? `<ul>${tips.map(t => `<li><b>${esc(t.card)}</b>: ${esc(t.tip)}</li>`).join("")}</ul>` : ""}`;
}

const adviceWhen = x => new Date(x.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function renderAdvice() {
  const run = $("advice-run"), state = $("advice-state");
  if (!apiKey) {
    run.disabled = true;
    state.textContent = "Add your Anthropic API key above to turn on Advice."; state.className = "hint";
  } else if (!adviceCtl) run.disabled = false;
  const out = $("advice-result");
  if (!advice || !D) { out.innerHTML = ""; return; }
  const R = advice.result || {};
  const byId = new Map(D.archetypes.map((a, i) => [a.id, i]));
  const list = v => (Array.isArray(v) ? v : []).filter(x => typeof x === "string");
  exportLists.length = 0;
  const picks = (Array.isArray(R.picks) ? R.picks : []).filter(p => p && byId.has(p.deck_id)).slice(0, 3).map(p => {
    const i = byId.get(p.deck_id), a = D.archetypes[i], r = rating(i), t = tierOf(i);
    const best = p.role === "Best pick";
    return `<article class="panel pick${best ? " best" : ""}">
      <div class="pick-head">
        ${spritesHtml(a)}
        <div><div class="role">${best ? "Best pick" : "Alternative"}</div><h3><button data-deck="${i}">${esc(a.name)}</button></h3></div>
        ${t ? `<span class="badge" style="background:var(--tier-${t})" title="Tier ${t} with your current My meta">${t}</span>` : ""}
      </div>
      ${r ? `<div class="nums"><span>Chance of a favorable matchup <b>${pct(r.fav, 0)}</b></span><span>Expected winrate <b>${pct(r.exp)}</b></span></div>` : ""}
      ${adviceRegionals(a)}
      ${typeof p.why === "string" && p.why ? `<p>${esc(p.why)}</p>` : ""}
      ${list(p.strong_against).length ? `<h4>Strong against</h4><div class="chips">${list(p.strong_against).map(s => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
      ${list(p.watch_out).length ? `<h4>Watch out</h4><ul>${list(p.watch_out).map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${adviceList(a, p)}
      ${typeof p.confidence === "string" ? `<span class="conf">Confidence: ${esc(p.confidence)}</span>` : ""}
    </article>`;
  }).join("");
  const avoid = (Array.isArray(R.avoid) ? R.avoid : []).filter(v => v && byId.has(v.deck_id)).slice(0, 3);
  const notes = list(R.caveats).slice(0, 3);
  const stale = (advice.dataGenerated && D.generated && advice.dataGenerated !== D.generated)
    || (L && advice.labsGenerated !== (L.generated || null));
  // Eerdere Advice uit deze browser terughalen.
  const earlier = adviceHistory.length > 1 ? ` <label class="hint">Earlier Advice <select id="advice-history">${adviceHistory.map((x, k) =>
    `<option value="${k}"${x === advice ? " selected" : ""}>${esc(adviceWhen(x))}</option>`).join("")}</select></label>` : "";
  out.innerHTML = `
    <div class="panel adv-summary">${esc(typeof R.summary === "string" ? R.summary : "")}
      <div class="meta">Advice from ${esc(adviceWhen(advice))}${advice.context ? " · with your extra context" : ""}${stale ? " · made with older data, analyze again" : ""}. Changed My meta? Analyze again.${earlier}</div>
    </div>
    <div class="adv-picks">${picks || `<div class="panel state">No usable Advice received. Try again.</div>`}</div>
    ${avoid.length || notes.length ? `<div class="data-grid">
      ${avoid.length ? `<div class="panel adv-list adv-avoid"><h3>Better not</h3><ul>${avoid.map(v => `<li><b>${esc(D.archetypes[byId.get(v.deck_id)].name)}</b>: ${esc(typeof v.why === "string" ? v.why : "")}</li>`).join("")}</ul></div>` : ""}
      ${notes.length ? `<div class="panel adv-list"><h3>Caveats</h3><ul>${notes.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
    </div>` : ""}`;
}

// ---------- Vragen over dit deck (Claude-chat) ----------
// Per deck een gesprek; Claude krijgt bij elk bericht de actuele data van het deck mee (als system prompt).
// De gesprekken blijven in de browser (storage.js), buiten Settings.
const chats = new Map();       // deckId -> {turns: [{role, content, cut?}]}
const saveChats = () => storage.saveDeckChats(Object.fromEntries([...chats].map(([id, c]) => [id, c.turns])));
let chatRun = null;            // {id, text, ctl} van het lopende antwoord
let chatSig = "", chatDraft = "", chatStateMsg = { text: "", cls: "" };
const chatLists = [];          // lijsten in het gesprek, achter de kopieerknoppen
const CHAT_KEEP = 30;          // zoveel berichten bewaren en meesturen
const chatOf = id => { if (!chats.has(id)) chats.set(id, { turns: [] }); return chats.get(id); };

// Kaarten opzoeken op naam, set en nummer (zoals Claude ze in een lijst schrijft).
const BASIC_ENERGY = /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal) energy$/i;
function cardIndex() {
  if (L._idx) return L._idx;
  const full = new Map(), byName = new Map();
  L.cards.forEach(([nm, set, num], k) => {
    full.set(`${norm(nm)}|${String(set).toUpperCase()}|${String(num).replace(/^0+/, "")}`, k);
    const key = norm(nm);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(k);
  });
  return (L._idx = { full, byName });
}
function matchCard(name, set, num, l) {
  if (!L) return null;
  if (/^basic .+ energy$/i.test(name)) name = name.replace(/^basic /i, "");
  const { full, byName } = cardIndex();
  if (set && num) {
    const k = full.get(`${norm(name)}|${String(set).toUpperCase()}|${String(num).replace(/^0+/, "")}`);
    if (k != null) return k;
  }
  const ks = byName.get(norm(name));
  if (!ks) return null;
  if (ks.length === 1) return ks[0];
  const inDeck = new Set([...(l?.usage || []).map(u => u[0]), ...(l?.consensus || []).map(c => c[0])]);
  return ks.find(k => inDeck.has(k)) ?? (set ? ks.find(k => cardOf(k)[1] === String(set).toUpperCase()) : null) ?? ks[0];
}

// Tel een lijst, check de regels en schat met het model wat hij scheelt t.o.v. een gemiddelde lijst.
function evalList(entries, l, R) {
  const counts = new Map(), unknown = [], problems = [], perName = new Map();
  let total = 0;
  for (const e of entries) {
    const n = Math.round(Number(e.n));
    if (!(n > 0) || !e.name) continue;
    total += n;
    const k = matchCard(e.name, e.set, e.num, l);
    if (k == null) unknown.push({ n, name: e.name, set: e.set || "", num: e.num || "" });
    else counts.set(k, (counts.get(k) || 0) + n);
    const nm = k == null ? e.name : cardOf(k)[0];
    if (!BASIC_ENERGY.test(nm)) perName.set(norm(nm), { nm, n: (perName.get(norm(nm))?.n || 0) + n });
  }
  if (total !== 60) problems.push(`The list has ${total} cards instead of 60.`);
  for (const { nm, n } of perName.values()) if (n > 4) problems.push(`${n}× ${nm}: at most 4 per card name.`);
  if (unknown.length) problems.push(`Not found in the data: ${unknown.map(u => u.name).join(", ")}.`);
  let est = null, contrib = [];
  if (R && l?.ml) {
    let v = 0, varSum = 0;
    for (const [k, ef] of R.effects) {
      const d = (counts.get(k) || 0) - ef.mean;
      v += d * ef.e; varSum += (d * ef.se) ** 2;
      if (Math.abs(d * ef.e) >= 0.001) contrib.push({ k, n: counts.get(k) || 0, mean: ef.mean, v: d * ef.e });
    }
    est = { v, se: Math.sqrt(varSum), signal: l.ml.signal };
    contrib.sort((p, q) => Math.abs(q.v) - Math.abs(p.v));
  }
  const matched = [...counts.entries()];
  return { total, matched, unknown, problems, est, contrib: contrib.slice(0, 8) };
}

function chatExportText(ev) {
  const groups = [[], [], []];
  ev.matched.forEach(([k, n]) => { const [nm, set, num, sec] = cardOf(k); groups[sec].push(`${n} ${nm} ${set} ${num}`.trim()); });
  ev.unknown.forEach(u => groups[/energy$/i.test(u.name) ? 2 : 1].push(`${u.n} ${u.name} ${u.set} ${u.num}`.trim()));
  const out = [];
  groups.forEach((rows, s) => {
    if (!rows.length) return;
    out.push(`${SECTION_TITLES[s]}: ${rows.reduce((t, r) => t + Number(r.split(" ")[0]), 0)}`, ...rows, "");
  });
  out.push(`Total Cards: ${ev.total}`);
  return out.join("\n");
}

// Regels uit een ```lijst-blok: "4 Kaartnaam SET NUMMER" (set en nummer mogen ontbreken).
function parseListLines(lines) {
  const out = [];
  for (let raw of lines) {
    const ln = raw.trim().replace(/^[-*•]\s+/, "");
    if (!ln || /^total cards/i.test(ln) || /^[A-Za-zÀ-ÿé ]+:\s*\d*\s*$/.test(ln)) continue;
    const m = ln.match(/^(\d+)\s*[x×]?\s+(.+)$/);
    if (!m) continue;
    const rest = m[2].trim().replace(/\s+\(.*\)$/, "");
    const f = rest.match(/^(.*\S)\s+((?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{1,5})\s+([A-Za-z]{0,3}\d+[a-z]?)$/);
    out.push(f ? { n: Number(m[1]), name: f[1], set: f[2], num: f[3] } : { n: Number(m[1]), name: rest });
  }
  return out;
}
const looksLikeList = lines => { const c = lines.filter(x => /^\s*\d+\s*[x×]?\s+\S/.test(x)).length; return c >= 8 && c >= lines.filter(x => x.trim()).length * 0.6; };

function chatListHtml(entries, a) {
  const l = L && labsById.get(a.id);
  const R = l?.ml ? recommend(l) : null;
  const ev = evalList(entries, l, R);
  chatLists.push(ev);
  const unk = ev.unknown.length ? `<div class="sec-title">Not recognized</div><ul class="cards">${ev.unknown.map(u => `<li>${u.n} ${esc(u.name)}<span class="set">${esc(u.set)} ${esc(u.num)}</span></li>`).join("")}</ul>` : "";
  const est = ev.est ? `<span>Model vs. an average ${esc(a.name)} list <b class="${ev.est.v >= 0 ? "pos" : "neg"}">${ppTxt(ev.est.v)}</b> (± ${ppTxt(ev.est.se).slice(1)}, rough sum${ev.est.signal ? "" : "; card choices make no measurable difference for this deck"})</span>` : "";
  return `<div class="chat-list">
    <div class="nums"><span>Total <b>${ev.total}</b> cards</span>${est}</div>
    ${ev.problems.map(p => `<div class="warn">${esc(p)}</div>`).join("")}
    <details class="list"><summary>View the list</summary><div class="mini">${L ? bySection(ev.matched, miniRow) : ""}${unk}</div></details>
    <div class="upload-row"><button class="btn primary" data-chatcopy="${chatLists.length - 1}">Copy for PTCG Live</button><span class="hint copy-state"></span></div>
  </div>`;
}

// Kleine, veilige Markdown-weergave: alles wordt eerst ge-escaped.
const inlineMd = t => esc(t)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
  .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
function mdToHtml(src, a) {
  const lines = src.replace(/\r/g, "").split("\n"), out = [];
  let para = [], list = null, i = 0;
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map(x => `<li>${inlineMd(x)}</li>`).join("")}</${list.t}>`); list = null; } };
  const flush = () => { flushP(); flushL(); };
  while (i < lines.length) {
    const ln = lines[i];
    const fence = ln.match(/^\s*```\s*([\w-]*)/);
    if (fence) {
      flush();
      const lang = fence[1].toLowerCase(), body = [];
      let closed = false;
      for (i++; i < lines.length; i++) { if (/^\s*```/.test(lines[i])) { closed = true; i++; break; } body.push(lines[i]); }
      if (lang === "lijst" || lang === "list" || (!lang && looksLikeList(body))) out.push(closed ? chatListHtml(parseListLines(body), a) : `<div class="chat-list note">Writing the list…</div>`);
      else out.push(`<pre class="code">${esc(body.join("\n"))}</pre>`);
      continue;
    }
    let m;
    if (!ln.trim()) flush();
    else if ((m = ln.match(/^\s*#{1,6}\s+(.*)/))) { flush(); out.push(`<h4>${inlineMd(m[1])}</h4>`); }
    else if ((m = ln.match(/^\s*[-*•]\s+(.*)/)) || (m = ln.match(/^\s*\d+[.)]\s+(.*)/))) {
      const t = /^\s*\d/.test(ln) ? "ol" : "ul";
      flushP();
      if (list && list.t !== t) flushL();
      if (!list) list = { t, items: [] };
      list.items.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(ln)) list.items[list.items.length - 1] += " " + ln.trim();
    else { flushL(); para.push(ln); }
    i++;
  }
  flush();
  return out.join("");
}

// Alles wat Claude over dit deck moet weten, als vaste eerste beurt van het gesprek.
function deckChatContext(i, useTools) {
  const a = D.archetypes[i], r = rating(i);
  const nameOf = id => id === "overig" ? "other decks" : (D.archetypes.find(o => o.id === id)?.name || L?.archetypes.find(o => o.id === id)?.name || id);
  const lvOf = id => { const j = D.archetypes.findIndex(o => o.id === id); return j >= 0 ? LABEL[level(j)] : "unknown"; };
  const cl = k => { const [nm, set, num] = cardOf(k); return `${nm} ${set} ${num}`.trim(); };
  const pp = x => (x < 0 ? "−" : "+") + Math.abs(x * 100).toFixed(1);
  const opps = D.archetypes.map((o, j) => ({ o, j, lv: level(j) })).filter(x => x.lv > 0)
    .sort((x, y) => y.lv - x.lv || y.o.share - x.o.share);
  const mus = opps.map(({ o, j, lv }) => {
    const m = matchup(i, j);
    return `- ${o.name}: meets it ${LABEL[lv].toLowerCase()} · ${m ? `${pct(m.p, 0)} winrate (${m.g} games, certainty ${certainty(m.g)}/5)` : "no data, counts as 50%"}`;
  });
  const parts = [];
  const l = L && labsById.get(a.id);
  if (l) {
    parts.push(`## Regionals (Limitless Labs, ${L.events.length} Regionals this season, Masters only${L.settings?.top ? `, only the top ${L.settings.top} per Regional; Day 2 and final placement count within that group` : ""})
Share ${pct(l.share)} · Day 2 ${pct(l.day2, 0)} (${times(l.conv)} the average of ${pct(L.day2_rate, 0)}) · ${l.topcut} top cuts · average placement top ${pct(1 - l.pct, 0)} · ${l.players} players`);
    if (l.lists.length) {
      const use = new Map(l.usage.map(u => [u[0], u]));
      parts.push(`## Consensus list (average of ${l.lists_n} lists, recent events count more; may never have been played exactly like this)
${l.consensus.map(([k, c]) => { const u = use.get(k); return `- ${c} ${cl(k)}${u ? ` · in ${pct(u[1], 0)} of lists, avg. ${fmt1(u[3])}×` : ""}`; }).join("\n")}`);
      const inList = new Set(l.consensus.map(([k]) => k));
      const others = l.usage.filter(u => !inList.has(u[0]));
      if (others.length) parts.push(`## Other cards that are played (in 3% or more of lists; count = most played)
${others.map(u => `- ${u[2]} ${cl(u[0])} · in ${pct(u[1], 0)} of lists, avg. ${fmt1(u[3])}× when included`).join("\n")}`);
      parts.push(`## Real lists (best finishes, plus the most typical Day 2 list)
${l.lists.map(x => `- ${x.place ? `${x.place} of ${x.of}` : "no placement"}, ${cityOf(x.e)}, ${x.rec}${x.top ? ", top cut" : x.day2 ? ", Day 2" : ""}${x.typical ? ", most typical" : ""}: ${x.cards.map(([k, c]) => `${c} ${cl(k)}`).join("; ")}`).join("\n")}`);
    }
    const M = l.ml;
    if (!M) parts.push(`## Model\nToo few lists for the card model: only the usage figures above.`);
    else {
      const R = recommend(l);
      if (R) {
        const { x, up } = R.best;
        parts.push(`## Recommended list for their meta (statistical model)
${M.signal ? "" : "Note: for this deck the card choices in the data make no measurable difference; the consensus list is a fine choice and the effects below are noise.\n"}Chosen from ${M.cands.length} Day 2 lists: ${x.place} of ${x.of} in ${cityOf(x.e)} (${x.rec}). Expected advantage against their meta ${pp(up)} pp win chance compared with an average list (± ${pp(x.se).slice(1)}).
${x.cards.map(([k, c]) => `${c} ${cl(k)}`).join("; ")}`);
        const lines = M.cards.map(([k, b, se, mean, g, gse]) => {
          const ef = R.effects.get(k);
          const clear = Math.abs(ef.e) >= 2 * ef.se ? " (clear)" : "";
          const per = M.inter.map((c, j) => {
            const p = sigm(M.base + (M.opps[c] ?? 0)), s = p * (1 - p);
            const e = (b + g[j]) * s, sd = Math.sqrt(se * se + gse[j] * gse[j]) * s;
            return `${nameOf(c)} [${lvOf(c)}] ${pp(e)}±${pp(sd).slice(1)}`;
          });
          return `- ${cl(k)} (avg. ${fmt1(mean)}×): against their meta ${pp(ef.e)}±${pp(ef.se).slice(1)}${clear} | per opponent: ${per.join("; ")}`;
        });
        parts.push(`## Model effect per extra copy (in pp win chance; ± = uncertainty; in [ ] how often they meet that opponent)
The model only knows these ${M.cards.length} cards; for other cards there is only usage data. Trained on ${M.games} games from the Regionals. "Other decks" is everything not modeled separately.
${lines.join("\n")}`);
      } else parts.push(`## Model\nThe player has not set anything in My meta yet, so there is no model advice for their meta.`);
    }
  } else parts.push(`## Regionals\n${L ? "This deck was not played at the Regionals in the data: there are no decklists or card data." : "No Regionals data is loaded: no decklists or card data."}`);

  return `You are an experienced Pokémon TCG player and coach (Standard format). The player is chatting with you about one deck: ${a.name}. They want to know which version to play, why cards are in the deck, whether cards are worth it, and to arrive together at a 60-card list that fits the data and their preferences.

## How you answer
- In English, direct and short: usually 2 to 6 sentences or a short list. No introduction, no repeating the question, no tables (they read on their phone), no em dashes.
- For "why is card X in it" or "is card Y worth it": combine (1) the data below: in what share of lists, the usual count, and the model effect per extra copy, in total against their meta and per opponent; and (2) your own knowledge of what the card does and which deck mechanic or matchup it serves (for example protection against bench damage, energy acceleration, consistency, a counter for a specific deck). Name concretely which opponents in their meta the card helps against. Make clear what comes from the data and what from your card knowledge. If you are not sure what a card does (for example from a new set), say so and do not invent an effect.
- Model effects are small and uncertain. Only call an effect clear if it is at least twice as large as the ±. Model effects may partly come from strong players making certain choices.
- Which version: compare the recommended list, the consensus list and the real lists with their meta and preferences.
- Give a decklist in a code block with the language list (\`\`\`list), one line per card in exactly this form: "4 Card Name SET NUMBER", with no headings or comments in the block. Exactly 60 cards, at most 4 per card name (basic energy excepted). Only use cards with a set and number from the data below, unless the player names another card. After the block, explain in a few lines where you differ from the consensus list and why.${useTools ? `
- Check every list with the check_list tool before you give it, and adjust it if the tool reports problems. Do not write text before you call the tool.` : ""}
- Do not invent numbers, results or lists that are not in the data.

## How the data works
- Matchups: Trainerhill, tournaments with ${D.filters.players}+ players from ${D.filters.start_date} to ${D.filters.end_date}. Winrate = (wins + ties/3) / games. Certainty 1-5 by number of games (1 = fewer than 20, 5 = 400+).
- "How often" is the player's own estimate for their locals: very often, often, regularly, sometimes, rarely (each step weighs 3× as much).
- pp = percentage point of win chance.

## ${a.name} in their meta
${r ? `Tier ${tierOf(i)} · chance of a favorable matchup ${pct(r.fav, 0)} · expected winrate ${pct(r.exp)}` : "No meta set yet."}
Matchups against the decks they meet (most often first):
${mus.join("\n") || "(no decks set)"}

${parts.join("\n\n")}`;
}

// Tool waarmee Claude een lijst kan laten tellen en schatten voordat hij hem geeft (check_list).
function chatTools(a) {
  const l = L && labsById.get(a.id);
  if (!l) return null;
  return [{
    name: "check_list",
    description: "Checks a 60-card list for this deck: counts the cards, checks the 4-copy rule, reports cards that are not in the data, and gives the model estimate (pp win chance compared with an average list, against the player's meta) with the cards that contribute most.",
    input_schema: {
      type: "object",
      properties: { cards: { type: "array", items: { type: "object", properties: {
        count: { type: "integer" }, name: { type: "string" }, set: { type: "string" }, number: { type: "string" } }, required: ["count", "name"] } } },
      required: ["cards"],
    },
    run(input) {
      if (!Array.isArray(input?.cards)) throw new Error("cards must be a list");
      setChatState("Checking the list…");
      const R = l.ml ? recommend(l) : null;
      const ev = evalList(input.cards.slice(0, 80).map(c => ({ n: Number(c?.count), name: String(c?.name || ""), set: c?.set ? String(c.set) : "", num: c?.number ? String(c.number) : "" })), l, R);
      return {
        total: ev.total,
        problems: ev.problems,
        model: ev.est ? { advantage_pp: +(ev.est.v * 100).toFixed(2), uncertainty_pp: +(ev.est.se * 100).toFixed(2), measurable_difference_for_this_deck: ev.est.signal } : "no model for this deck",
        biggest_contributions: ev.contrib.map(c => ({ card: `${cardOf(c.k)[0]} ${cardOf(c.k)[1]} ${cardOf(c.k)[2]}`, count: c.n, average: +c.mean.toFixed(2), pp: +(c.v * 100).toFixed(2) })),
      };
    },
  }];
}

// Codes uit ai.js -> wat de bezoeker kan doen; als bij Advice, met een paar zinnen voor de chat.
const CHAT_ERRORS = {
  ...ADVICE_ERRORS,
  model_unavailable: "The Claude model for Deck chat is not available with your API key.",
  too_large: "The chat has become too long. Start a new chat.",
  refused: "Claude declined to answer. Ask your question differently.",
};
function setChatState(text, cls = "") {
  chatStateMsg = { text, cls };
  const el = $("chat-state");
  if (el) { el.textContent = text; el.className = "hint " + cls; }
}

function chatSuggestions(a) {
  const l = L && labsById.get(a.id);
  const q = [`Which version of ${a.name} should I play in my meta?`, "Build a 60-card list for my meta with me."];
  if (l?.consensus?.length) {
    const pick = l.consensus.find(([k, c]) => cardOf(k)[3] === 2 && c >= 2) || l.consensus.find(([k, c]) => cardOf(k)[3] === 1 && c >= 3);
    if (pick) q.push(`Why does this deck play ${pick[1]}× ${cardOf(pick[0])[0]}?`);
    const inList = new Set(l.consensus.map(([k]) => k));
    const tech = l.usage.find(u => !inList.has(u[0]) && u[1] >= 0.1);
    if (tech) q.push(`Is ${cardOf(tech[0])[0]} worth adding to the deck?`);
  }
  q.push("Which cards help against my worst matchups?");
  return q;
}

function renderChat() {
  const box = $("deck-chat");
  if (selected == null || !D) { box.hidden = true; chatSig = ""; return; }
  const a = D.archetypes[selected];
  const sig = `${a.id}|${!!apiKey}|${L?.generated || ""}`;
  if (sig === chatSig && box.innerHTML) return;
  chatSig = sig;
  box.hidden = false;
  if (!chatOn()) {
    box.innerHTML = `<div class="chat-head"><h2>Deck chat: ${esc(a.name)}</h2></div><p class="note">Deck chat is off: it uses Claude with your own Anthropic API key. <a href="#advice" data-goto="advice">Add your API key</a> in Ask Claude to turn it on.</p>`;
    return;
  }
  const c = chatOf(a.id), busy = chatRun?.id === a.id;
  chatLists.length = 0;
  const msg = t => t.role === "user"
    ? `<div class="msg user">${esc(t.content)}</div>`
    : `<div class="msg bot">${mdToHtml(t.content, a)}${t.cut ? `<div class="interrupted">Answer interrupted.</div>` : ""}</div>`;
  box.innerHTML = `
    <div class="chat-head"><h2>Deck chat: ${esc(a.name)}</h2>${c.turns.length ? `<button class="btn" id="chat-new" type="button">New chat</button>` : ""}</div>
    <p class="note">Deck chat knows My meta, the matchups, the Regionals lists and the card model for this deck. Ask which version to play, why a card is in it, or build a 60-card list that fits your preferences. This uses your own Claude credit.</p>
    <div class="chat-log" id="chat-log" aria-live="polite">
      ${c.turns.map(msg).join("")}
      ${busy ? `<div class="msg bot" id="chat-live">${chatRun.text ? mdToHtml(chatRun.text, a) : `<span class="thinking">Thinking…</span>`}</div>` : ""}
    </div>
    ${!c.turns.length && !busy ? `<div class="chat-sugg-row">${chatSuggestions(a).map(q => `<button class="chat-sugg" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    <form class="chat-form" id="chat-form">
      <label for="chat-input" class="visually-hidden">Your question</label>
      <textarea id="chat-input" rows="2" placeholder="For example: is Shaymin worth it in this deck?">${esc(chatDraft)}</textarea>
      <div class="upload-row">
        <button class="btn primary" type="submit" id="chat-send"${busy || chatRun ? " disabled" : ""}>Send</button>
        <button class="btn" type="button" id="chat-stop"${busy ? "" : " hidden"}>Stop</button>
        <span class="hint ${chatStateMsg.cls}" id="chat-state">${esc(chatStateMsg.text)}</span>
      </div>
    </form>`;
}

async function sendChat(text) {
  text = text.trim().slice(0, 4000);
  if (!text || chatRun || !chatOn() || selected == null) return;
  const i = selected, a = D.archetypes[i], id = a.id, c = chatOf(id);
  c.turns.push({ role: "user", content: text });
  saveChats();
  chatDraft = "";
  const ctl = new AbortController();
  chatRun = { id, text: "", ctl };
  setChatState("");
  chatSig = ""; renderChat();
  $("chat-live")?.scrollIntoView({ block: "nearest" });
  const tools = chatTools(a);
  // Het gesprek moet met een vraag beginnen; afgekapte antwoorden gaan gewoon mee.
  const recent = c.turns.slice(-CHAT_KEEP);
  const messages = recent.slice(recent.findIndex(t => t.role === "user")).map(t => ({ role: t.role, content: t.content }));
  let pending = 0;
  const paint = () => {
    pending = 0;
    const el = $("chat-live");
    if (el && chatRun?.id === id && chatSig.startsWith(id + "|")) { chatLists.length = 0; el.innerHTML = mdToHtml(chatRun.text, a) || `<span class="thinking">Thinking…</span>`; }
  };
  try {
    const res = await createAI(apiKey).chat({ system: deckChatContext(i, !!tools), messages, tools: tools || [], signal: ctl.signal,
      onText: t => { chatRun.text = t; setChatState(""); if (!pending) pending = requestAnimationFrame(paint); } });
    c.turns.push({ role: "assistant", content: res.text, cut: res.truncated });
    setChatState(res.truncated ? "The answer was cut off. Ask for less at once." : "");
  } catch (e) {
    if (e?.text && e.code !== "refused") c.turns.push({ role: "assistant", content: e.text, cut: true });
    if (e?.code === "cancelled") setChatState("Stopped.");
    else setChatState(CHAT_ERRORS[e?.code] || "Something went wrong with Claude. Try again.", "err");
  } finally {
    if (pending) cancelAnimationFrame(pending);
    saveChats();
    chatRun = null;
    chatSig = ""; renderChat();
    if (selected != null && D.archetypes[selected].id === id) $("chat-log")?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
}

const chatBox = $("deck-chat");
chatBox.addEventListener("submit", e => { e.preventDefault(); sendChat($("chat-input").value); });
chatBox.addEventListener("input", e => { if (e.target.id === "chat-input") chatDraft = e.target.value; });
chatBox.addEventListener("keydown", e => {
  if (e.target.id === "chat-input" && e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
    e.preventDefault(); sendChat(e.target.value);
  }
});
let chatNewArmed = false;
chatBox.addEventListener("click", e => {
  const q = e.target.closest("button[data-q]");
  if (q) { sendChat(q.dataset.q); return; }
  if (e.target.closest("#chat-stop")) { chatRun?.ctl.abort(); return; }
  const nw = e.target.closest("#chat-new");
  if (nw) {
    if (!chatNewArmed) { chatNewArmed = true; nw.textContent = "Click again to clear"; nw.classList.add("danger-confirm");
      setTimeout(() => { chatNewArmed = false; if (nw.isConnected) { nw.textContent = "New chat"; nw.classList.remove("danger-confirm"); } }, 3000); return; }
    chatNewArmed = false;
    chatRun?.ctl.abort();
    const id = D.archetypes[selected].id;
    chatOf(id).turns = []; saveChats(); setChatState(""); chatSig = ""; renderChat();
    return;
  }
  const cp = e.target.closest("button[data-chatcopy]");
  if (cp) {
    const text = chatExportText(chatLists[Number(cp.dataset.chatcopy)]);
    const row = cp.parentElement;
    copyText(text, row.querySelector(".copy-state"), () => {
      let t = row.nextElementSibling;
      if (!t?.matches("textarea.copy-fallback")) { t = document.createElement("textarea"); t.className = "copy-fallback"; t.rows = 10; t.readOnly = true; row.after(t); }
      t.value = text; t.select();
    });
  }
});

async function start() {
  ({ localFrequencies, continent } = storage.loadSettings());
  $("continent").value = continent;
  apiKey = storage.loadApiKey();
  adviceHistory = storage.loadAdviceHistory();
  advice = adviceHistory[0] ?? null;
  for (const [id, turns] of Object.entries(storage.loadDeckChats())) chats.set(id, { turns });
  renderKey();
  route();
  const labsReq = fetch("labs.json").then(r => r.ok ? r.json() : null).catch(() => null);
  try {
    applyData(await fetch("data.json").then(r => r.json()), "bundled");
  } catch {
    $("tiers").innerHTML = `<div class="state">The data could not be loaded. Reload the page.</div>`;
    $("foot-period").textContent = "Data not loaded";
  }
  const labs = await labsReq;
  if (labs && isLabs(labs)) applyLabs(labs, "bundled");
  renderFooter();

  route();
}
start();
