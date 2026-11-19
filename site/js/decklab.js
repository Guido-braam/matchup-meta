// ---------- Deck Lab: kansen en testhanden voor één decklijst ----------
// Draait in een eigen shadow root, zodat de stijlen niet botsen met de rest van de pagina.
import { findCard, loadCardIndex, cardTile, cardById, norm } from "./cards.js";

// ---------- Rows: de lijst zelf ----------
// Deck Lab bewaart de lijst als rows {count, name, set, num, cat}, één per regel zoals hij binnenkwam,
// zodat prints en niet-herkende regels blijven staan. serialize(rows) is de tekst (PTCG Live-formaat)
// waar parse, de analyse en My lists op werken.
const ENERGY_SYM = {G:"Grass",R:"Fire",W:"Water",L:"Lightning",P:"Psychic",F:"Fighting",D:"Darkness",M:"Metal",Y:"Fairy",N:"Dragon",C:"Colorless"};
const CAT_OF = {Pokemon:"pokemon", Trainer:"trainer", Energy:"energy"};
const SECTION = /^(pok[eé]mon|trainers?|energy)\b[^:]*:/i;
const SEC_TITLE = {pokemon:"Pokémon", trainer:"Trainer", energy:"Energy"};

// Eén lijstregel als {count, name, set, num}; null voor een kop, de Total-regel of iets anders.
export function parseLine(raw){
  const line = raw.trim();
  if (!line || SECTION.test(line) || /^total/i.test(line)) return null;
  const m = line.match(/^(\d+)x?\s+(.+)$/); if (!m) return null;
  let name = m[2].trim(), set = "", num = "";
  const s = name.match(/^(.*?)\s+([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?)\s+([A-Za-z0-9]{1,6})$/);
  if (s) { name = s[1]; set = s[2]; num = s[3]; }
  return {count:+m[1], name, set, num};
}
// "Basic {D} Energy" -> "Basic Darkness Energy", om de kaart te vinden.
const typedName = name => name.replace(/\{([A-Z])\}/g, (_, c) => ENERGY_SYM[c] || c).replace(/\s+/g, " ");

// Tekst -> rows. cat komt uit de Card index; een onbekende regel houdt de sectie waar hij onder stond.
export function rowsFrom(text, index){
  const rows = []; let sec = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const h = raw.trim().match(SECTION);
    if (h) { sec = /^p/i.test(h[1]) ? "pokemon" : /^t/i.test(h[1]) ? "trainer" : "energy"; continue; }
    const r = parseLine(raw); if (!r) continue;
    const card = findCard(index, r.set, r.num, typedName(r.name));
    rows.push({...r, cat: card ? CAT_OF[card.category] : sec});
  }
  return rows;
}

// Rows -> PTCG Live-tekst: per sectie een kop met het aantal, dan de regels zoals ze binnenkwamen.
export function serialize(rows){
  const sum = rs => rs.reduce((s, r) => s + r.count, 0);
  const line = r => `${r.count} ${r.name}${r.set ? ` ${r.set} ${r.num}` : ""}`;
  const out = [];
  for (const cat of Object.keys(SEC_TITLE)) {
    const rs = rows.filter(r => r.cat === cat);
    if (rs.length) out.push(`${SEC_TITLE[cat]}: ${sum(rs)}`, ...rs.map(line), "");
  }
  const loose = rows.filter(r => !SEC_TITLE[r.cat]);
  if (loose.length) out.push(...loose.map(line), "");
  if (rows.length) out.push(`Total Cards: ${sum(rows)}`);
  return out.join("\n");
}

// De Card van een row met de naam en categorie waaronder Deck Lab hem telt. key is dezelfde voor dezelfde kaartnaam
// uit verschillende sets (Boss's Orders ASC 256 + PR-SW 251): dat is één entry. Onbekend: cat null.
function cardOfRow(index, r){
  const typed = typedName(r.name), card = findCard(index, r.set, r.num, typed);
  const name = card ? card.name : typed, cat = card ? CAT_OF[card.category] : null;
  return {card, name, cat, key: keyOf(cat, name)};
}
// "Basic Fire Energy" and "Fire Energy" are the same card.
const keyOf = (cat, name) => cat + "|" + (cat === "energy" ? name.toLowerCase().replace(/^basic /, "") : name.toLowerCase());

// ---------- Deckregels ----------
// + mag tot 4 per naam (over alle prints), basis-Energy zonder maximum; een niet-herkende regel krijgt geen +.
export const canAdd = e => !!e.cat && (e.sub === "basic" || e.count < 4);
// Waarschuwingen voor de balk boven de lijst; blokkeren doet Deck Lab niet (een import met 5 kopieën laadt gewoon).
export function deckWarnings(E){
  const total = E.reduce((s, e) => s + e.count, 0), ace = E.filter(e => e.ace).reduce((s, e) => s + e.count, 0);
  const out = [];
  if (total !== 60) out.push(`${total} / 60 cards. A deck needs exactly 60.`);
  if (ace > 1) out.push(`${ace} ACE SPEC cards. A deck may have only 1.`);
  return out;
}
// − of + op een entry (key): de eerste row van die kaart krijgt er één bij of af; op 0 gaat die row weg.
export function bump(rows, index, key, d){
  const i = rows.findIndex(r => cardOfRow(index, r).key === key);
  if (i < 0) return rows;
  const out = rows.slice(); out[i] = {...out[i], count: out[i].count + d};
  return out[i].count > 0 ? out : out.filter((_, j) => j !== i);
}

// ---------- Add a card ----------
// Search the rows of cards/search.json in one category: every word must be in the name, text, types or stage/type
// (without accents). Name matches first, then A–Z; at most max rows, total is the number of matches.
const hayOf = r => norm([r.name, r.text, ...(r.types || []), r.stage?.replace(/(\d)/, " $1"), r.trainerType, r.energyType].filter(Boolean).join(" "));
export function searchCards(list, cat, query, max = 50){
  const words = norm(query).split(" ").filter(Boolean);
  const hits = list.filter(r => { if (CAT_OF[r.category] !== cat) return false; const h = hayOf(r); return words.every(w => h.includes(w)); });
  const inName = r => words.length && words.every(w => norm(r.name).includes(w)) ? 0 : 1;
  hits.sort((a, b) => inName(a) - inName(b) || a.name.localeCompare(b.name));
  return {total: hits.length, rows: hits.slice(0, max)};
}
// Set code and number of a Card id for a list line ("sv06-017" -> TWM 17); no code known: no set.
export function printOf(index, id){
  const k = id.lastIndexOf("-"), setId = id.slice(0, k), num = id.slice(k + 1).replace(/^0+(?=.)/, "");
  const code = Object.keys(index?.sets || {}).find(c => index.sets[c].some(s => s.id === setId));
  return code ? {set: code, num} : {set: "", num: ""};
}
export const searchKey = s => keyOf(CAT_OF[s.category], s.name);
// Add one of a search row. Trainer and Energy: +1 on the entry with that name. Pokémon: +1 on a row of this very
// Card, else a new row, so another version with the same name (Applin Grass / Dragon) gets its own line.
// ponytail: an older print of the same Pokémon also gets a new line; compare card text if that bothers.
export function addRow(rows, index, s){
  const cat = CAT_OF[s.category], key = searchKey(s);
  const i = rows.findIndex(r => { const c = cardOfRow(index, r); return c.key === key && (cat !== "pokemon" || c.card?.id === s.id); });
  if (i >= 0) return rows.map((r, j) => j === i ? {...r, count: r.count + 1} : r);
  return [...rows, {count: 1, name: s.name, ...printOf(index, s.id), cat}];
}

export const DeckLab = (() => {
  // Items (en Artazon) waarmee je zonder Supporter Pokémon op je bank krijgt.
  // Dit is strategie, geen kaartdata: de Card index zegt niet welke Items Pokémon zoeken, dus deze lijst blijft.
  const SETUP_ITEMS = new Set(["buddy-buddy poffin","nest ball","ultra ball","poké pad","battle vip pass","level ball","hisuian heavy ball","great ball","quick ball","evolution incense","mysterious treasure","techno radar","poké ball","timer ball","capturing aroma","secret box","master ball","artazon","bug catching set"]);
  const CAT_LABEL = {pokemon:"Pokémon",trainer:"Trainer",energy:"Energy"};
  const SUB_LABEL = {item:"Item",supporter:"Supporter",tool:"Tool",stadium:"Stadium",basic:"Basic",special:"Special"};
  const STAGE_LABEL = ["Basic","Stage 1","Stage 2"];
  const addTitle = cat => `Add ${cat === "energy" ? "an" : "a"} ${CAT_LABEL[cat]} card`;
  const TURNS = 5, N_SIM = 20000, N_QUICK = 10000;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pct = (x, d=0) => (x*100).toFixed(d) + "%";

  // ---------- Lijst inlezen ----------
  // Categorie, stage, trainer type, energy type en ACE SPEC komen uit de Card index (findCard).
  // Een regel zonder kaart (cat null) telt mee voor de 60, maar voor geen enkele categorie.
  function parse(text, index){
    const map = new Map();
    for (const raw of text.split(/\r?\n/)) {
      const r = parseLine(raw); if (!r) continue;
      const {set, num, count: n} = r, {card, name, cat, key} = cardOfRow(index, r);
      if (map.has(key)) { const e = map.get(key); e.count += n; if (set) e.prints.push(set + " " + num); continue; }
      map.set(key, {key, name, set, num, count:n, cat, card, prints: set ? [set + " " + num] : [],
        // Alleen "Basic" is een Basic; andere evoluties (BREAK, VMAX) tellen als Stage 1. Trainer zonder type: Item.
        stage: cat !== "pokemon" || card.stage === "Basic" ? 0 : card.stage === "Stage2" ? 2 : 1,
        sub: cat === "trainer" ? (card.trainerType || "Item").toLowerCase() :cat === "energy" ? (card.energyType === "Special" ? "special" : "basic") : null,
        ace: !!card?.aceSpec});
    }
    const order = {pokemon:0, trainer:1, energy:2};
    return [...map.values()].sort((a,b) => (order[a.cat] ?? 3) - (order[b.cat] ?? 3));
  }

  const isBasicEntry = e => e.cat === "pokemon" && e.stage === 0;
  const count = (E, f) => E.filter(f).reduce((s,e) => s + e.count, 0);
  const totalOf = E => count(E, () => true);
  const catColor = c => `var(--c-${c === "pokemon" ? "poke" : c})`;
  const tagOf = e => e.cat === "pokemon" ? STAGE_LABEL[e.stage] : SUB_LABEL[e.sub];
  function choose(n, k){ if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  function mulligan(E){ const t = totalOf(E), b = count(E, isBasicEntry); return t >= 7 ? choose(t - b, 7) / choose(t, 7) : 1; }

  // ---------- Monte Carlo ----------
  function rand(n){ return Math.floor(Math.random()*n); }
  function partial(pool, from, to){ const n = pool.length; for (let i = from; i < to; i++){ const j = i + rand(n - i); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; } }
  function simGames(E, N, onGame){
    const pool = []; E.forEach((e,i) => { for (let k = 0; k < e.count; k++) pool.push(i); });
    const P = Int16Array.from(pool), basic = E.map(isBasicEntry);
    if (!basic.some(Boolean) || P.length < 7 + 6 + TURNS) return false;
    for (let it = 0; it < N; it++){
      let m = 0;
      for (;;) { partial(P, 0, 7); let ok = false; for (let i = 0; i < 7; i++) if (basic[P[i]]) { ok = true; break; } if (ok || m > 40) break; m++; }
      partial(P, 7, 7 + 6 + TURNS);
      onGame(P, m, basic);
    }
    return true;
  }
  // Kaartvolgorde na opzet: 0-6 hand, 7-12 prijzen, 13+ trekstapel
  const seenIdx = t => t === 0 ? [0,1,2,3,4,5,6] : [...seenIdx(0), ...Array.from({length:t}, (_, k) => 13 + k)];
  function stats(E, N = N_SIM){
    const n = E.length, sup = E.map(e => e.sub === "supporter");
    const basicsDist = new Array(8).fill(0), supT = new Float64Array(TURNS+1), flag = new Uint8Array(n);
    const ok = simGames(E, N, (P, m, basic) => {
      let b = 0; for (let i = 0; i < 7; i++) if (basic[P[i]]) b++; basicsDist[b]++;
      flag.fill(0);
      for (let t = 0; t <= TURNS; t++){
        if (t === 0) { for (let i = 0; i < 7; i++) flag[P[i]] = 1; } else flag[P[12 + t]] = 1;
        for (let e = 0; e < n; e++) if (flag[e] && sup[e]) { supT[t]++; break; }
      }
    });
    if (!ok) return null;
    return { basicsDist: basicsDist.map(x => x / N), supT: [...supT].map(x => x / N) };
  }
  function comboProb(E, a, b, t){
    let hit = 0; const idx = seenIdx(t);
    simGames(E, N_SIM, P => { let ha = false, hb = false, two = 0;
      for (const i of idx){ if (P[i] === a){ ha = true; two++; } if (P[i] === b) hb = true; }
      if (a === b ? two >= 2 : ha && hb) hit++; });
    return hit / N_SIM;
  }

  /* Eerste of tweede: beide spelers zien in hun eerste beurt 8 kaarten (starthand + trekking).
     Als eerste mag je geen Supporter spelen, dus telt alleen wat je met Basics en items neerzet. */
  const clamp = x => Math.max(-1, Math.min(1, x));
  function firstSecond(E, N = N_SIM){
    const setup = E.map(e => SETUP_ITEMS.has(e.name.toLowerCase()));
    const sup = E.map(e => e.sub === "supporter");
    const gear = E.map(e => /^pokégear/i.test(e.name));
    if (totalOf(E) < 7 + 6 + TURNS + 7) return null;
    let gF = 0, gS = 0, sA = 0;
    const idx = seenIdx(1);
    const ok = simGames(E, N, (P, m, basic) => {
      partial(P, 7 + 6 + TURNS, 7 + 6 + TURNS + 7);
      let b = 0, st = false, sp = false, gr = false;
      for (const i of idx){ const c = P[i]; if (basic[c]) b++; if (setup[c]) st = true; if (sup[c]) sp = true; if (gear[c]) gr = true; }
      // Pokégear 3.0 kijkt naar de bovenste 7 kaarten (posities 14-20) voor een Supporter
      if (!sp && gr) for (let i = 14; i < 21; i++) if (sup[P[i]]) { sp = true; break; }
      const f = st || b >= 2;
      if (f) gF++; if (f || sp) gS++; if (sp) sA++;
    });
    if (!ok) return null;
    const goodFirst = gF / N, goodSecond = gS / N, supAcc = sA / N;
    const nPoke = count(E, e => e.cat === "pokemon"), nEvo = count(E, e => e.cat === "pokemon" && e.stage > 0);
    const nSetup = count(E, e => setup[E.indexOf(e)]);
    const evoShare = nPoke ? nEvo / nPoke : 0, gap = goodSecond - goodFirst;
    const factors = [
      {name:"Start without a Supporter", val:pct(goodFirst), score:clamp((goodFirst - .75) / .15), w:1,
       why:`Chance that, going first, you build a Bench on turn 1 with only Basics and search Items (at least 2 Basics, or an Item such as Poffin or Nest Ball). You play ${nSetup} of those Items.`},
      {name:"Supporter on turn 1", val:"+" + Math.round(gap * 100) + "%", score:-clamp((gap - .08) / .1), w:1,
       why:`How much more often you start well going second, when you may play a Supporter (${pct(supAcc)} chance of a Supporter${gear.some(Boolean) ? ", Pokégear included" : ""}). The bigger this gap, the more your deck leans on that first Supporter.`},
      {name:"Game plan", val:pct(evoShare), score:clamp((evoShare - .3) / .25), w:.8,
       why:evoShare >= .3 ? `${nEvo} of your ${nPoke} Pokémon are evolutions. Going first, you evolve a full turn before your opponent.`
         : `Your deck leans mostly on Basics (${nEvo} of ${nPoke} Pokémon are evolutions). Going second, you attack first, because the starting player may not attack on turn 1.`}
    ];
    const score = factors.reduce((s,f) => s + f.score * f.w, 0), max = factors.reduce((s,f) => s + f.w, 0);
    const r = score / max;
    return {factors, r, goodFirst, goodSecond, verdict: r > .2 ? "Go first" : r < -.2 ? "Go second" : "No clear preference"};
  }

  // Kerncijfers voor een lijst, voor elders op de pagina. Async: eerst de Card index. Bewaard per lijst.
  const qcache = new Map();
  function quick(text){
    if (!qcache.has(text)) qcache.set(text, loadCardIndex().then(index => {
      const E = parse(text, index), st = stats(E, N_QUICK), fs = firstSecond(E, N_QUICK);
      return { total: totalOf(E), nBasic: count(E, isBasicEntry), mullP: mulligan(E), sup1: st ? st.supT[1] : null, verdict: fs ? fs.verdict : null };
    }));
    return qcache.get(text);
  }

  // ---------- Weergave ----------
  const CSS = `
:host{display:block;--ink:var(--fg);--sunk:var(--surface-2);--accent-ink:var(--accent-fg);
  --f-display:var(--font-display);--f-body:var(--font-body);--f-mono:ui-monospace,"Cascadia Mono",Consolas,monospace;--r:var(--radius,10px);
  font-family:var(--f-body);color:var(--ink);font-size:14px;line-height:1.5}
*{box-sizing:border-box}
button,select,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.num{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}}
.panel{background:var(--surface);border-radius:var(--r);padding:16px}
.side{display:flex;flex-direction:column;gap:14px}
.col{display:flex;flex-direction:column;gap:10px}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
textarea{width:100%;min-height:200px;resize:vertical;border:1px solid var(--line);border-radius:8px;background:var(--sunk);padding:10px;font-family:var(--f-mono);font-size:12px;line-height:1.55}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:7px 12px;font-weight:600;font-size:13px}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.cardlist{display:flex;flex-direction:column;gap:2px}
#src:empty,#io-state:empty{display:none}
.cl-head{display:flex;justify-content:space-between;margin-top:10px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.cl-head:first-child{margin-top:0}
.count-bar{background:color-mix(in oklab,var(--bad) 16%,transparent);color:var(--bad);border-radius:8px;padding:8px 12px;font-weight:600;font-size:13px}
.count-bar[hidden]{display:none}
.count-bar{white-space:pre-line}
.cl-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:4px;margin-top:6px}
.cl-row .nm{font-size:8.5px}
.cl-row .art{font-size:14px}
.cl-row .ft{display:none}
.cl-row .cnt{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);min-width:15px;height:15px;padding:0 4px;border-radius:99px;background:var(--accent);color:var(--accent-ink);font:700 10px/15px var(--f-body);text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)}
/* Telefoon: 5 per rij. */
/* − en + onder de kaart: minstens 36px hoog, ook op een telefoon met 5 per rij. */
.cl-row{display:flex;flex-direction:column;gap:3px}
.pm{display:flex;gap:2px}
.pm button{flex:1;min-width:0;min-height:36px;padding:0;border:1px solid var(--line);border-radius:6px;background:var(--sunk);font-weight:700;font-size:16px;line-height:1}
.pm button:hover:not(:disabled){border-color:var(--accent)}
.pm button:disabled{opacity:.35;cursor:default}
@media (max-width:560px){.cl-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.cl-row .cnt{min-width:18px;height:18px;font-size:11px;line-height:18px}}
/* Groot scherm: 4 per rij in de linkerkolom (ongeveer 62px; Test hand is 84px). */
@media (min-width:901px){.cl-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.cl-row .nm{font-size:9px}.cl-row .art{font-size:18px}.cl-row .cnt{min-width:18px;height:18px;bottom:3px;font-size:11px;line-height:18px}}
/* With a mouse: − and + sit on the card itself, left half −, right half +, and show on the hover zoom
   (the whole row zooms, since the buttons cover the tile). Touch keeps the row under the card. */
@media (hover:hover){
.cl-row:has(.pm){position:relative;transition:transform .15s}
.cl-row:has(.pm):is(:hover,:has(:focus-visible)){transform:scale(2.5);z-index:5}
.cl-row:has(.pm):is(:hover,:has(:focus-visible)) .ctile{box-shadow:0 8px 24px rgb(0 0 0/.5)}
.cl-row .pm{position:absolute;inset:0;gap:0;justify-content:space-between;opacity:0;transition:opacity .15s}
.cl-row:is(:hover,:has(:focus-visible)) .pm{opacity:1}
.cl-row .pm button{flex:0 0 33.333%;min-height:0;border:0;border-radius:0;background:transparent;color:#fff;font-size:22px;font-weight:800;text-shadow:0 0 2px #000,0 0 5px #000;cursor:pointer}
.cl-row .pm [data-pm="-1"]{border-radius:6px 0 0 6px}.cl-row .pm [data-pm="1"]{border-radius:0 6px 6px 0}
.cl-row .pm button:hover:not(:disabled),.cl-row .pm button:focus-visible{background:rgb(0 0 0/.35);outline:none}
.cl-row .pm button:disabled{opacity:.3;cursor:not-allowed}}
/* Touch: no − and + in the overview; a tap on a card opens it with its count and big − and + (#cz). */
@media (hover:none){.cl-row .pm{display:none}.cl-row .ctile{cursor:pointer}}
#cz{width:100vw;max-width:100vw;height:100dvh;max-height:none;margin:0;border-radius:0;background:rgb(0 0 0/.92);color:#fff;padding:12px 16px calc(16px + env(safe-area-inset-bottom,0px))}
.cz-in{height:100%;display:flex;flex-direction:column;align-items:center;gap:12px}
.cz-in .x{align-self:flex-end;color:#fff}
.cz-card{flex:1;min-height:0;width:100%;display:grid;place-items:center}
.cz-card .ctile{width:min(100%,calc((100dvh - 220px) * 63 / 88));height:auto;aspect-ratio:63/88}
.cz-card .ctile img{cursor:default}
.cz-n{font-size:16px}.cz-n .num{font-size:28px;font-weight:800;margin-right:6px}
.cz-pm{display:flex;gap:12px;width:100%;max-width:420px}
.cz-pm .btn{flex:1;min-height:60px;font-size:32px;font-weight:800;line-height:1}
.btn[hidden]{display:none}
.btn:disabled{opacity:.5;cursor:default;border-color:var(--line)}
.io{gap:6px}
.io .btn{flex:1 1 auto;white-space:nowrap;padding:7px 10px}
/* Zonder lijst: Import deck, de deckkeuze en de lege blokken, midden op de pagina. */
:host(.empty) .layout{grid-template-columns:minmax(0,520px);justify-content:center;padding-top:8vh}
:host(.empty) main,:host(.empty) .full-only{display:none}
:host(.empty) .side>.panel:first-child{background:none;padding:0}
.or{text-align:center;font-size:14px}
:host(:not(.empty)) .or,:host(:not(.empty)) .empty-only{display:none}
/* Import deck: een eigen pop-up in de shadow root. */
dialog{border:0;border-radius:var(--r);background:var(--surface);color:var(--ink);padding:16px;width:min(520px,calc(100vw - 32px))}
dialog::backdrop{background:rgb(0 0 0/.5)}
dialog h2{margin:0;font-size:18px}
.x{border:0;background:none;font-size:22px;line-height:1;padding:4px 8px}
.hint{font-size:12px;color:var(--muted);margin:0}
.stack{display:flex;flex-direction:column;gap:18px}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{background:var(--surface);border-radius:var(--r);padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.tile .big{font-family:var(--f-display);font-weight:800;font-size:32px;line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
@media (max-width:560px){.tiles{gap:8px}.tile{padding:10px}.tile .big{font-size:24px}}
.tile .sub{font-size:12px;color:var(--muted)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;width:fit-content}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.good{color:var(--good);background:color-mix(in oklab,var(--good) 14%,transparent)}
.pill.warn{color:var(--warn);background:color-mix(in oklab,var(--warn) 16%,transparent)}
.pill.bad{color:var(--bad);background:color-mix(in oklab,var(--bad) 14%,transparent)}
.pill.info{color:var(--muted);background:var(--sunk)}
h2{font-family:var(--f-display);font-weight:800;font-size:19px;letter-spacing:-.01em;margin:0;text-wrap:balance}
.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.sec-head p{margin:0;color:var(--muted);font-size:13px;max-width:60ch}
.compbar{display:flex;height:34px;border-radius:8px;overflow:hidden;gap:2px}
.compbar div{display:flex;align-items:center;padding:0 10px;color:#fff;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;min-width:0}
.legend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:14px}
@media (max-width:560px){.legend{grid-template-columns:minmax(0,1fr)}}
.legend h3{margin:0 0 6px;font-size:13px;display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:3px;flex:none}
.mini{display:grid;grid-template-columns:auto minmax(0,1fr) 24px;gap:4px 8px;align-items:center;font-size:12px}
.mini .tr{height:8px;background:var(--sunk);border-radius:4px;overflow:hidden}
.mini .tr i{display:block;height:100%;border-radius:4px}
.bars{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end;height:170px;padding-top:20px}
.bars .b{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px}
.bars .b i{display:block;width:100%;background:var(--c-poke);border-radius:5px 5px 2px 2px;min-height:2px}
.bars .b em{font-style:normal;font-size:11px;font-family:var(--f-mono)}
.axis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;border-top:1px solid var(--line);padding-top:4px;font-size:12px;text-align:center;font-weight:600}
.combo{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px}
@media (max-width:560px){.combo{grid-template-columns:minmax(0,1fr)}}
select{border:1px solid var(--line);background:var(--sunk);border-radius:8px;padding:7px 8px;min-width:0;width:100%}
.combo-out{display:flex;align-items:baseline;gap:12px;margin-top:14px;flex-wrap:wrap}
.combo-out .big{font-family:var(--f-display);font-weight:800;font-size:44px;line-height:1;letter-spacing:-.03em;color:var(--accent);font-variant-numeric:tabular-nums}
.fs-verdict{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.fs-verdict .big{font-family:var(--f-display);font-weight:800;font-size:38px;line-height:1;letter-spacing:-.03em;color:var(--accent)}
.gauge{position:relative;height:10px;border-radius:999px;margin:18px 0 6px;background:linear-gradient(90deg,color-mix(in oklab,var(--c-trainer) 55%,var(--sunk)),var(--sunk) 50%,color-mix(in oklab,var(--c-energy) 60%,var(--sunk)))}
.gauge::before{content:"";position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:var(--muted)}
.gauge i{position:absolute;top:50%;width:20px;height:20px;border-radius:50%;background:var(--ink);border:3px solid var(--surface);transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.25)}
.gauge-l{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:var(--muted)}
.factors{display:flex;flex-direction:column;gap:12px;margin-top:18px}
.factor{display:grid;grid-template-columns:minmax(0,1.1fr) 70px 100px minmax(0,2fr);gap:12px;align-items:start;padding-top:12px;border-top:1px solid var(--line);font-size:13px}
.factor b{font-weight:600}
.factor .v{font-family:var(--f-mono);font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
@media (max-width:760px){.factor{grid-template-columns:minmax(0,1fr) auto}.factor .why{grid-column:1/-1}}
.lean{font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;width:fit-content;white-space:nowrap}
.lean.first{color:var(--c-energy);background:color-mix(in oklab,var(--c-energy) 16%,transparent)}
.lean.second{color:var(--c-trainer);background:color-mix(in oklab,var(--c-trainer) 14%,transparent)}
.lean.neutral{color:var(--muted);background:var(--sunk)}
details.rules{margin-top:16px;font-size:13px}
details.rules summary{cursor:pointer;font-weight:600}
details.rules ul{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px;max-width:75ch}
.th{display:flex;flex-direction:column;gap:16px}
.th-zone{background:var(--mat);border:1px solid var(--mat-line);border-radius:12px;padding:12px 14px}
.zone-t{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;font-weight:600;color:var(--muted);margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cards{display:flex;flex-wrap:wrap;gap:8px}
.cw{display:flex;flex-direction:column;align-items:center;gap:3px}
.cw>span{font-size:11px;font-family:var(--f-mono);color:var(--muted)}
summary.zone-t{cursor:pointer;list-style:none;margin-bottom:0}
summary.zone-t::before{content:"▸"}
details[open]>summary.zone-t{margin-bottom:8px}
details[open]>summary.zone-t::before{content:"▾"}
.th-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
@media (max-width:1100px){.th-split{grid-template-columns:minmax(0,1fr)}}
.mull{opacity:.55}
/* Meerdere mulligans: duidelijk ruimte en een lijn tussen de handen. */
.mull+.mull{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.card{width:84px;flex:none}
.card.sm{width:60px}
/* Kaarttegel van cardTile() (cards.js); zelfde regels als .ctile in style.css, die de shadow root niet bereikt. */
.ctile{position:relative;aspect-ratio:63/88;border-radius:6px;overflow:hidden}
@media (hover:hover){.ctile:has(img){transition:transform .15s}.ctile:has(img):hover{transform:scale(2.5);z-index:5;box-shadow:0 8px 24px rgb(0 0 0/.5)}.ctile:has(img):hover .cnt{opacity:0}}
.ctile img{display:block;width:100%;height:100%;object-fit:cover;cursor:zoom-in}
.ctile:not(.ph)>span:not(.cnt){display:none}
.ctile.ph{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);font-size:10px;line-height:1.2;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ctile .band{height:5px;flex:none}
.ctile .nm{font-weight:600;padding:4px 5px 2px;font-size:10.5px;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ctile .art{flex:1;margin:0 5px;border-radius:4px;display:grid;place-items:center;min-height:0;font:800 22px var(--f-display);letter-spacing:-.03em;color:rgba(255,255,255,.92)}
.ctile .ft{padding:3px 5px 4px;font-size:9px;color:var(--muted);text-align:center}
.card.sm .nm{font-size:8.5px}
.card.sm .art{font-size:16px}
.card.sm .ft{display:none}
/* [+] at the end of each block: opens Add a card. */
.add-tile{aspect-ratio:63/88;width:100%;border:2px dashed var(--line);border-radius:6px;background:none;font-size:24px;font-weight:700;color:var(--muted)}
.add-tile:hover{border-color:var(--accent);color:var(--accent)}
/* Add a card: the list scrolls, the search box stays. Full screen on a phone. */
#add{height:min(720px,calc(100dvh - 32px));max-height:none}
#add>form{height:100%}
.add-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;margin:0 -6px;padding:0 6px}
.add-it{display:grid;grid-template-columns:52px minmax(0,1fr) 112px;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.add-it .ctile:has(img):hover{transform:none;box-shadow:none}
.add-info{display:flex;flex-direction:column;min-width:0;font-size:13px}
.add-info .hint{font-size:11.5px}
.add-txt{font-size:11.5px;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.add-it .pm{align-items:center}
.add-it .pm .num{min-width:22px;text-align:center;font-weight:700}
input[type=search]{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--sunk);padding:9px 10px}
@media (max-width:560px){#add{width:100vw;max-width:100vw;height:100dvh;margin:0;border-radius:0}.add-it{grid-template-columns:44px minmax(0,1fr) 104px;gap:8px}}
/* Click zoom (cards.js) inside a pop-up here; the same as .card-zoom in style.css. */
.card-zoom{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:6px;background:rgb(0 0 0/.85)}
.card-zoom img{width:min(100%,calc((100dvh - 12px) * 63 / 88));height:auto;border-radius:12px}`;

  const MARKUP = `
<div class="layout">
  <aside class="side">
    <div class="panel col">
      <slot name="arch"></slot>
      <div class="row io"><button class="btn primary" type="button" id="btn-import">Import deck</button><button class="btn" type="button" id="btn-export">Export deck</button><button class="btn full-only" type="button" id="btn-clear">Clear</button></div>
      <p class="hint" id="io-state" role="status"></p>
      <p class="hint or">or</p>
      <div class="empty-only"><slot name="load"></slot></div>
      <p class="hint" id="src"></p>
    </div>
    <slot name="save" class="full-only"></slot>
    <div class="count-bar full-only" id="total-badge" role="status" hidden></div>
    <div class="panel full-only">
      <div class="cardlist" id="cardlist" data-own-zoom></div>
    </div>
  </aside>
  <main><section id="view" class="stack"></section></main>
</div>
<dialog id="cz" aria-label="Card in the deck"><div class="cz-in">
  <button class="x" type="button" data-czx aria-label="Close">×</button>
  <div class="cz-card" id="cz-card"></div>
  <div class="cz-n"><span class="num" id="cz-n"></span>in the deck</div>
  <div class="cz-pm"><button class="btn" type="button" data-cz="-1" aria-label="Remove one">−</button><button class="btn primary" type="button" data-cz="1" aria-label="Add one">+</button></div>
</div></dialog>
<dialog id="add" aria-labelledby="add-t"><form method="dialog" class="col">
  <div class="row" style="justify-content:space-between"><h2 id="add-t">Add a card</h2><button class="x" value="cancel" aria-label="Close">×</button></div>
  <input id="add-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, text or type" aria-label="Search cards">
  <p class="hint" id="add-state" role="status"></p>
  <div class="add-list" id="add-list"></div>
</form></dialog>`;

  let root = null, rows = [], rowsReady = Promise.resolve(), entries = [], TH = null, srcLabel = "";
  const $ = s => root.querySelector(s);

  function renderList(){
    // Alleen een balk als de lijst niet op 60 uitkomt of meer dan één ACE SPEC heeft.
    const warn = rows.length ? deckWarnings(entries) : [];
    const tb = $("#total-badge"); tb.hidden = !warn.length; tb.textContent = warn.join("\n");
    let html = "";
    // De drie blokken staan er altijd, ook leeg; "Not recognized" alleen als er zulke regels zijn.
    for (const cat of ["pokemon","trainer","energy",null]){
      const list = entries.filter(e => e.cat === cat); if (!cat && !list.length) continue;
      html += `<div class="cl-head"><span class="label" style="color:${cat ? catColor(cat) : "var(--bad)"}">${cat ? CAT_LABEL[cat] : "Not recognized"}</span><span class="num label">${count(list, () => true)}</span></div>`;
      // Kleine kaarttegels met het aantal; stage/type en ACE SPEC staan in de (verborgen) note.
      html += `<div class="cl-grid">${list.map(e => {
        const note = cat ? (e.ace ? "ACE SPEC · " : "") + tagOf(e) : "card not recognized";
        // − en + eronder; een niet-herkende regel heeft alleen −.
        const k = esc(e.key), n = esc(e.name);
        const pm = `<div class="pm"><button type="button" data-pm="-1" data-key="${k}" aria-label="Remove one ${n}">−</button>`
          + (cat ? `<button type="button" data-pm="1" data-key="${k}" aria-label="Add one ${n}"${canAdd(e) ? "" : " disabled"}>+</button>` : "") + "</div>";
        return `<div class="cl-row" data-key="${k}">${cardTile(e.card, {name: e.name, cat: cat || "pokemon", count: e.count, note})}${pm}</div>`;
      }).join("")}${cat ? `<div class="cl-row"><button type="button" class="add-tile" data-add="${cat}" aria-label="${addTitle(cat)}">+</button></div>` : ""}</div>`;
    }
    // Same cards as now (only counts changed, after − or +): update the counts in place, so the zoomed card under
    // the mouse stays as it is instead of being drawn anew and zooming in again.
    const box = $("#cardlist"), t = document.createElement("div"); t.innerHTML = html;
    const keys = el => [...el.querySelectorAll('[data-pm="-1"]')].map(b => b.dataset.key).join("\n");
    if (!box.children.length || keys(box) !== keys(t)) { box.innerHTML = html; return; }
    const pairs = s => { const n = t.querySelectorAll(s); return [...box.querySelectorAll(s)].map((el, i) => [el, n[i]]); };
    for (const [el, n] of pairs(".cl-head .num, .cnt")) el.textContent = n.textContent;
    for (const [el, n] of pairs('[data-pm="1"]')) el.disabled = n.disabled;
  }

  function fsHTML(fs){
    const leanOf = s => s > .25 ? ["first","First"] : s < -.25 ? ["second","Second"] : ["neutral","Neutral"];
    const sub = fs.r > .2 ? "Your deck sets up well without a Supporter, so the extra turn of setup outweighs the turn 1 limits."
      : fs.r < -.2 ? "Your deck needs that first Supporter or the first attack more than a turn of head start."
      : "The pros and cons roughly balance out. Let the matchup decide.";
    return `<div class="panel"><div class="sec-head"><div><h2>First or second?</h2><p>Based on how this deck gets through its first turn. It is a rule of thumb: the matchup can turn it around.</p></div></div>
      <div class="fs-verdict"><span class="big">${fs.verdict}</span><span class="hint">${sub}</span></div>
      <div class="gauge" role="img" aria-label="Preference: ${fs.verdict}"><i style="left:${(fs.r + 1) / 2 * 100}%"></i></div>
      <div class="gauge-l"><span>Second</span><span>First</span></div>
      <div class="row" style="margin-top:12px;gap:16px"><span class="hint">Good first turn going first: <b class="num" style="color:var(--ink)">${pct(fs.goodFirst)}</b></span><span class="hint">going second: <b class="num" style="color:var(--ink)">${pct(fs.goodSecond)}</b></span></div>
      <div class="factors">${fs.factors.map(f => { const [c,l] = leanOf(f.score); return `<div class="factor"><b>${f.name}</b><span class="v">${f.val}</span><span class="lean ${c}">${l}</span><span class="why hint">${f.why}</span></div>`; }).join("")}</div>
      <details class="rules"><summary>What the rules and players say</summary><ul>
        <li>The player who goes first may not attack or play a Supporter on their first turn. Items, Stadiums, Energy and Basics are allowed.</li>
        <li>Nobody may evolve on their own first turn, or evolve a Pokémon put down that turn. Rare Candy also only works from your second turn.</li>
        <li>So the player who goes second can attack first and play a draw Supporter such as Lillie's Determination right away.</li>
        <li>The player who goes first evolves and attaches Energy a full turn before the opponent.</li>
        <li>Rule of thumb among players: decks with fast Basic attackers often want to go second, setup decks that start well without a Supporter often want to go first. Against a deck that hits hard on its first turn, going second takes that attack away.</li>
        <li>This calculation assumes both players draw a card on turn 1; sources disagree on this.</li>
      </ul></details></div>`;
  }

  function renderAnalysis(){
    const view = $("#view");
    if (!entries.length){ view.innerHTML = `<div class="panel"><h2>Paste a list</h2><p class="hint">Use the export from Pokémon TCG Live or Limitless, or open a deck from the Deck tab.</p></div>`; return; }
    const total = totalOf(entries);
    const by = c => count(entries, e => e.cat === c);
    const cnt = f => count(entries, f);
    const nBasic = cnt(isBasicEntry), nSup = cnt(e => e.sub === "supporter");
    const mullP = mulligan(entries);
    const st = stats(entries);
    const avgBasics = st ? st.basicsDist.reduce((s,p,i) => s + p*i, 0) : 0;
    const expMull = mullP < 1 ? mullP / (1 - mullP) : Infinity;
    const tone = p => p > .25 ? "bad" : p > .18 ? "warn" : "good";

    let html = `<div class="tiles">
      <div class="tile"><span class="label">Mulligan chance</span><span class="big">${pct(mullP,1)}</span><span class="pill ${tone(mullP)}">${mullP > .25 ? "High" : mullP > .18 ? "Average" : "Low"}</span><span class="sub">${expMull.toFixed(2)} mulligans per game on average</span></div>
      <div class="tile"><span class="label">Basics in opening hand</span><span class="big">${st ? avgBasics.toFixed(2) : "–"}</span><span class="sub">${nBasic} Basic Pokémon in the list</span><span class="sub">${st ? pct(1 - st.basicsDist[1]) + " chance of 2 or more" : ""}</span></div>
      <div class="tile"><span class="label">Supporter on first turn</span><span class="big">${st ? pct(st.supT[1]) : "–"}</span><span class="sub">Opening hand + 1 drawn card</span><span class="sub">${nSup} Supporters in the list</span></div>
    </div>`;

    const seg = (c, n) => n ? `<div style="flex:${n};background:${catColor(c)}" title="${CAT_LABEL[c]}: ${n}">${CAT_LABEL[c]} ${n}</div>` : "";
    const mini = (rows, color) => `<div class="mini">${rows.map(([l,n]) => `<span>${l}</span><span class="tr"><i style="width:${total ? Math.min(100, n/total*100*2.5) : 0}%;background:${color}"></i></span><span class="num" style="text-align:right">${n}</span>`).join("")}</div>`;
    html += `<div class="panel"><div class="sec-head"><h2>Composition</h2><p>${entries.length} unique cards</p></div>
      <div class="compbar">${seg("pokemon",by("pokemon"))}${seg("trainer",by("trainer"))}${seg("energy",by("energy"))}</div>
      <div class="legend">
        <div><h3><span class="dot" style="background:var(--c-poke)"></span>Pokémon</h3>${mini([0,1,2].map(s => [STAGE_LABEL[s], cnt(e => e.cat === "pokemon" && e.stage === s)]), "var(--c-poke)")}</div>
        <div><h3><span class="dot" style="background:var(--c-trainer)"></span>Trainer</h3>${mini(["supporter","item","tool","stadium"].map(s => [SUB_LABEL[s], cnt(e => e.cat === "trainer" && e.sub === s)]), "var(--c-trainer)")}</div>
        <div><h3><span class="dot" style="background:var(--c-energy)"></span>Energy</h3>${mini(["basic","special"].map(s => [SUB_LABEL[s], cnt(e => e.cat === "energy" && e.sub === s)]), "var(--c-energy)")}</div>
      </div></div>`;

    if (st){
      const maxB = Math.max(...st.basicsDist.slice(1));
      html += `<div class="panel"><div class="sec-head"><h2>Basics in your opening hand</h2><p>Distribution after mulligans</p></div>
        <div class="bars">${st.basicsDist.slice(1).map(p => `<div class="b"><em>${p >= .005 ? pct(p) : "<1%"}</em><i style="height:${maxB ? p/maxB*100 : 0}%"></i></div>`).join("")}</div>
        <div class="axis">${[1,2,3,4,5,6,7].map(n => `<span>${n}</span>`).join("")}</div></div>`;

      html += `<div class="panel"><div class="sec-head"><div><h2>Test hand</h2><p>A shuffled deck: your opening hand after any mulligans, your 6 Prize cards and the cards you draw next.</p></div><button class="btn primary" id="th-new">New hand</button></div><div class="th" id="th-body"></div></div>`;
      const opts = sel => entries.map((e,i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(e.name)} (${e.count})</option>`).join("");
      const a0 = Math.max(0, entries.findIndex(isBasicEntry)), b0 = Math.max(0, entries.findIndex(e => e.sub === "supporter"));
      html += `<div class="panel"><div class="sec-head"><h2>Combo check</h2><p>How often do you have two cards at once? Pick the same card twice to check for 2 copies.</p></div>
        <div class="combo"><select id="cb-a" aria-label="Card A">${opts(a0)}</select><select id="cb-b" aria-label="Card B">${opts(b0)}</select>
        <select id="cb-t" aria-label="When">${["Opening hand","Turn 1","Turn 2","Turn 3","Turn 4","Turn 5"].map((l,i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="combo-out"><span class="big" id="cb-out">–</span><span class="hint" id="cb-txt"></span></div></div>`;
      const fs = firstSecond(entries); if (fs) html += fsHTML(fs);
    }
    view.innerHTML = html;
    if (st){
      ["#cb-a","#cb-b","#cb-t"].forEach(s => $(s).addEventListener("change", runCombo)); runCombo();
      $("#th-new").onclick = dealHand;
      if (TH) renderHand(); else dealHand();
    }
  }
  function runCombo(){
    const a = +$("#cb-a").value, b = +$("#cb-b").value, t = +$("#cb-t").value;
    $("#cb-out").textContent = pct(comboProb(entries, a, b, t), 1);
    const when = t === 0 ? "in your opening hand" : `by turn ${t}`;
    $("#cb-txt").textContent = a === b ? `chance of 2× ${entries[a].name} ${when}` : `chance of ${entries[a].name} and ${entries[b].name} ${when}`;
  }

  // ---------- Testhand ----------
  const isBasic = c => isBasicEntry(entries[c.e]);
  function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = rand(i+1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Eén kaart als tegel uit cards.js: het plaatje, of de placeholder (ook voor een onbekende regel).
  function cardHTML(c, cls = ""){
    const e = entries[c.e];
    return `<div class="card ${cls}">${cardTile(e.card, {name: e.name, cat: e.cat || "pokemon", note: e.cat ? tagOf(e) : "card not recognized"})}</div>`;
  }
  function dealHand(){
    const all = []; entries.forEach((e,i) => { for (let k = 0; k < e.count; k++) all.push({e:i}); });
    const mulls = [];
    for (;;){
      const d = shuffle(all.slice()), hand = d.slice(0, 7);
      if (hand.some(isBasic) || mulls.length >= 40){ TH = {hand, prizes: d.slice(7, 13), draws: d.slice(13, 17), mulls}; break; }
      mulls.push(hand);
    }
    renderHand();
  }
  function renderHand(){
    const body = $("#th-body"); if (!body || !TH) return;
    // Mulligans en volgende trekkingen: op een groot scherm (twee kolommen) altijd zichtbaar. Kleiner: uitklapbaar,
    // elke nieuwe hand begint dicht.
    const fold = matchMedia("(max-width:900px)").matches;
    // note: uitleg die op een groot scherm in de kop staat en bij uitklappen mee in- en uitklapt.
    const zone = (id, title, inner, note = "") => fold
      ? `<details class="th-zone" id="${id}"><summary class="zone-t">${title}</summary>${note ? `<div class="zone-t">${note}</div>` : ""}${inner}</details>`
      : `<div class="th-zone" id="${id}"><div class="zone-t">${title}${note}</div>${inner}</div>`;
    const nB = TH.hand.filter(isBasic).length;
    let h = "";
    if (TH.mulls.length) h += zone("th-mulls", `<span class="pill bad">${TH.mulls.length} mulligan${TH.mulls.length > 1 ? "s" : ""}</span>`,
      TH.mulls.map(m => `<div class="cards mull">${m.map(c => cardHTML(c, "sm")).join("")}</div>`).join(""), "Hands without a Basic Pokémon");
    h += `<div class="th-zone"><div class="zone-t">Opening hand<span class="pill info">${nB} Basic${nB === 1 ? "" : "s"}</span></div><div class="cards">${TH.hand.map(c => cardHTML(c)).join("")}</div></div>`;
    h += `<div class="th-split"><div class="th-zone"><div class="zone-t">Prize cards</div><div class="cards">${TH.prizes.map(c => cardHTML(c, "sm")).join("")}</div></div>`;
    h += zone("th-draws", "Next 4 draws", `<div class="cards">${TH.draws.map((c, i) => `<div class="cw">${cardHTML(c, "sm")}<span>Turn ${i+1}</span></div>`).join("")}</div>`) + "</div>";
    body.innerHTML = h;
  }

  // ---------- Invoer ----------
  // Async: de Card index wordt bij het eerste gebruik geladen (één keer per pagina). Mislukt dat, dan is elke regel onbekend.
  async function load(){
    await rowsReady;
    $("#src").textContent = srcLabel;
    const index = await loadCardIndex();
    entries = parse(serialize(rows), index);
    root.host.classList.toggle("empty", !rows.length);
    $("#btn-export").hidden = !rows.length;
    TH = null; renderList(); renderAnalysis();
  }
  // Another list came in (open, Import, Clear): the page hears it as "lab-source" on the host (My lists in app.js).
  // It fires at once, so the page can set its own heading right after; the rows follow once the Card index is there
  // (current() and load() wait for them).
  const newSource = () => root.host.dispatchEvent(new CustomEvent("lab-source"));
  function setList(text, label){
    srcLabel = label; $("#io-state").textContent = "";
    rowsReady = loadCardIndex().then(index => { rows = rowsFrom(text, index); });
    newSource(); return load();
  }
  // After an edit in Deck Lab itself (− / + and adding cards): the label gets "(edited)" and the page hears "lab-edit".
  function edited(){
    // Without a label (a list under a heading) nothing shows; the changes block says it for an own list.
    if (srcLabel && !/\(edited\)$/.test(srcLabel)) srcLabel += " (edited)";
    root.host.dispatchEvent(new CustomEvent("lab-edit"));
    return load();
  }
  // ---------- One card, big (touch): its count with − and + under it ----------
  let czKey = null;
  function openZoom(key){
    const e = entries.find(x => x.key === key); if (!e) return;
    [...document.querySelectorAll("dialog[open]"), ...root.querySelectorAll("dialog[open]")].forEach(d => d.close());
    czKey = key;
    $("#cz-card").innerHTML = cardTile(e.card, {name: e.name, cat: e.cat || "pokemon", note: e.cat ? tagOf(e) : "card not recognized"});
    renderZoom(); $("#cz").showModal();
  }
  function renderZoom(){
    const e = entries.find(x => x.key === czKey);
    if (!e) return $("#cz").close(); // the last copy is out
    $("#cz-n").textContent = e.count;
    $('[data-cz="1"]').disabled = !e.cat || !canAdd(e);
  }
  // ---------- Add a card ----------
  let searchReq = null, addCat = null, shown = [];
  const loadSearch = () => searchReq ??= fetch("cards/search.json").then(r => r.ok ? r.json() : []).catch(() => []);
  function openAdd(cat){
    [...document.querySelectorAll("dialog[open]"), ...root.querySelectorAll("dialog[open]")].forEach(d => d.close()); // one pop-up at a time
    addCat = cat; $("#add-t").textContent = addTitle(cat);
    $("#add-q").value = ""; $("#add-list").innerHTML = ""; $("#add-state").textContent = "";
    $("#add").showModal(); $("#add-q").focus();
    renderResults();
  }
  // The results for the search box. A slower earlier search does not overwrite a newer one.
  let searchRun = 0;
  async function renderResults(){
    const run = ++searchRun, [list, index] = await Promise.all([loadSearch(), loadCardIndex()]);
    if (run !== searchRun) return;
    const {total, rows: hits} = searchCards(list, addCat, $("#add-q").value);
    shown = hits;
    $("#add-state").textContent = !list.length ? "Could not load the cards. Try again later."
      : !total ? "No cards found." : total > hits.length ? `Showing ${hits.length} of ${total}, refine your search.` : "";
    const sub = s => s.category === "Pokemon" ? [STAGE_LABEL[{Stage1: 1, Stage2: 2}[s.stage] ?? 0], (s.types || []).join("/"), s.hp ? s.hp + " HP" : ""].filter(Boolean).join(" · ")
      : s.category === "Trainer" ? (s.trainerType || "Item") : s.energyType === "Special" ? "Special Energy" : "Basic Energy";
    $("#add-list").innerHTML = hits.map(s => {
      const e = entries.find(x => x.key === searchKey(s)), n = e ? e.count : 0, p = printOf(index, s.id), nm = esc(s.name), id = esc(s.id);
      return `<div class="add-it">${cardTile(cardById(index, s.id), {name: s.name, cat: addCat})}
        <div class="add-info"><b>${nm}</b><span class="hint">${esc(sub(s))}${p.set ? ` · <span class="num">${esc(p.set + " " + p.num)}</span>` : ""}</span><span class="add-txt">${esc((s.text || "").replace(/\s+/g, " "))}</span></div>
        <div class="pm"><button type="button" data-pm="-1" data-id="${id}" aria-label="Remove one ${nm}"${n ? "" : " disabled"}>−</button><span class="num">${n}</span><button type="button" data-pm="1" data-id="${id}" aria-label="Add one ${nm}"${!e || canAdd(e) ? "" : " disabled"}>+</button></div></div>`;
    }).join("");
  }

  function mount(host, skipLoad = false){
    if (root) return;
    root = host.attachShadow({mode: "open"});
    root.innerHTML = `<style>${CSS}</style>${MARKUP}`;
    // Import deck pastes the clipboard at once. Reading it can be refused; then Ctrl+V on the page imports.
    const ioState = $("#io-state");
    let pasteArmed = false;
    const doImport = text => {
      pasteArmed = false;
      if (!rowsFrom(text, null).length) { ioState.textContent = "No card lines found on the clipboard. Copy a list from Pokémon TCG Live or Limitless (a line looks like 4 Dreepy TWM 128)."; return; }
      return setList(text, "Imported list");
    };
    $("#btn-import").onclick = async () => {
      try { return await doImport(await navigator.clipboard.readText()); } catch {}
      pasteArmed = true; ioState.textContent = "Could not read the clipboard. Press Ctrl+V to paste your list.";
    };
    document.addEventListener("paste", e => { if (pasteArmed) { e.preventDefault(); doImport(e.clipboardData.getData("text")); } });
    // − / + in the card list. The list is drawn again, so the focus goes back to the same button (or its partner).
    $("#cardlist").addEventListener("click", async e => {
      const a = e.target.closest("button[data-add]"); if (a) return openAdd(a.dataset.add);
      const t = e.target.closest(".ctile"); if (t) return openZoom(t.closest(".cl-row").dataset.key);
      const b = e.target.closest("button[data-pm]"); if (!b || b.disabled) return;
      const {key, pm} = b.dataset;
      rows = bump(rows, await loadCardIndex(), key, +pm);
      await edited();
      const sel = d => root.querySelector(`button[data-key="${globalThis.CSS.escape(key)}"][data-pm="${d}"]:not(:disabled)`); // CSS here is the stylesheet
      (sel(pm) || sel(-pm))?.focus();
    });
    $("#btn-export").onclick = async () => {
      const b = $("#btn-export");
      try { await navigator.clipboard.writeText(serialize(rows)); }
      catch { $("#io-state").textContent = "Could not copy to the clipboard. Allow clipboard access and try again."; return; }
      $("#io-state").textContent = "";
      b.textContent = "Copied"; setTimeout(() => { b.textContent = "Export deck"; }, 1500);
    };
    $("#btn-clear").onclick = () => setList("", "");
    const cz = $("#cz");
    cz.addEventListener("click", async e => {
      if (e.target === cz || e.target.closest("[data-czx]") || e.target.classList.contains("cz-card")) return cz.close();
      const b = e.target.closest("button[data-cz]"); if (!b || b.disabled) return;
      rows = bump(rows, await loadCardIndex(), czKey, +b.dataset.cz);
      await edited(); renderZoom();
    });
    // Add a card: search, then − / + per result; the pop-up stays open while you add.
    const add = $("#add"), addQ = $("#add-q"), addList = $("#add-list");
    addQ.addEventListener("input", renderResults);
    addQ.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }); // Enter would close the form
    add.addEventListener("close", () => $(`button[data-add="${addCat}"]`)?.focus());
    addList.addEventListener("click", async e => {
      const b = e.target.closest("button[data-pm]"); if (!b || b.disabled) return;
      const s = shown.find(r => r.id === b.dataset.id), pm = b.dataset.pm, index = await loadCardIndex();
      rows = pm === "1" ? addRow(rows, index, s) : bump(rows, index, searchKey(s), -1);
      await edited();
      const top = addList.scrollTop; await renderResults(); addList.scrollTop = top;
      const sel = d => addList.querySelector(`button[data-id="${globalThis.CSS.escape(s.id)}"][data-pm="${d}"]:not(:disabled)`);
      (sel(pm) || sel(-pm))?.focus();
    });
    // Deck Lab begint altijd leeg; er wordt geen lijst bewaard tussen bezoeken.
    rows = []; srcLabel = "";
    if (!skipLoad) load();
  }
  function open(host, text, label){
    mount(host, true);
    setList(text, label);
  }
  // The list in Deck Lab now: its text and cards ({id?, name, count}) for My lists.
  async function current(){
    await rowsReady;
    const text = serialize(rows), index = await loadCardIndex().catch(() => null);
    return { text, cards: parse(text, index).map(e => e.card?.id ? { id: e.card.id, name: e.name, count: e.count } : { name: e.name, count: e.count }) };
  }
  const label = s => { srcLabel = s; if (root) $("#src").textContent = s; };
  return { mount, open, quick, current, label };
})();
