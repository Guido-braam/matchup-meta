// ---------- Deck Lab: kansen en testhanden voor één decklijst ----------
// Draait in een eigen shadow root, zodat de stijlen niet botsen met de rest van de pagina.
import { findCard, loadCardIndex, cardTile } from "./cards.js";

export const DeckLab = (() => {
  const SAMPLE = `Pokémon: 8
4 Applin DRI 16
4 Cottonee WHT 4
4 Spinarak TWM 4
3 Frillish WHT 44
2 Sizzlipede PBL 9
4 Dipplin SCR 13
3 Jellicent ex WHT 45
2 Ariados POR 2

Trainer: 10
3 Hilda WHT 171
4 Lillie's Determination ASC 192
1 Boss's Orders ASC 256
3 Night Stretcher SFA 61
3 Perrin TWM 160
4 Buddy-Buddy Poffin ASC 184
3 Pokégear 3.0 SSH 174
1 Boss's Orders PR-SW 251
4 Poké Pad POR 81
2 Kofu SCR 138

Energy: 2
1 Legacy Energy TWM 167
5 Basic {G} Energy MEE 1

Total Cards: 60`;

  // Items (en Artazon) waarmee je zonder Supporter Pokémon op je bank krijgt.
  // Dit is strategie, geen kaartdata: de Card index zegt niet welke Items Pokémon zoeken, dus deze lijst blijft.
  const SETUP_ITEMS = new Set(["buddy-buddy poffin","nest ball","ultra ball","poké pad","battle vip pass","level ball","hisuian heavy ball","great ball","quick ball","evolution incense","mysterious treasure","techno radar","poké ball","timer ball","capturing aroma","secret box","master ball","artazon","bug catching set"]);
  const ENERGY_SYM = {G:"Grass",R:"Fire",W:"Water",L:"Lightning",P:"Psychic",F:"Fighting",D:"Darkness",M:"Metal",Y:"Fairy",N:"Dragon",C:"Colorless"};
  const CAT_LABEL = {pokemon:"Pokémon",trainer:"Trainer",energy:"Energy"};
  const SUB_LABEL = {item:"Item",supporter:"Supporter",tool:"Tool",stadium:"Stadium",basic:"Basic",special:"Special"};
  const STAGE_LABEL = ["Basic","Stage 1","Stage 2"];
  const TURNS = 5, N_SIM = 20000, N_QUICK = 10000;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pct = (x, d=0) => (x*100).toFixed(d) + "%";

  // ---------- Lijst inlezen ----------
  // Categorie, stage, trainer type, energy type en ACE SPEC komen uit de Card index (findCard).
  // Een regel zonder kaart (cat null) telt mee voor de 60, maar voor geen enkele categorie.
  const CAT_OF = {Pokemon:"pokemon", Trainer:"trainer", Energy:"energy"};
  function parse(text, index){
    const map = new Map();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      if (/^(pok[eé]mon|trainers?|energy)\b[^:]*:/i.test(line) || /^total/i.test(line)) continue;
      const m = line.match(/^(\d+)x?\s+(.+)$/); if (!m) continue;
      let rest = m[2].trim(), set = "", num = "";
      const s = rest.match(/^(.*?)\s+([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?)\s+([A-Za-z0-9]{1,6})$/);
      if (s) { rest = s[1]; set = s[2]; num = s[3]; }
      const typed = rest.replace(/\{([A-Z])\}/g, (_, c) => ENERGY_SYM[c] || c).replace(/\s+/g, " ");
      const card = findCard(index, set, num, typed), name = card ? card.name : typed;
      const cat = card ? CAT_OF[card.category] : null;
      // Dezelfde kaartnaam uit verschillende sets is één regel (Boss's Orders ASC 256 + PR-SW 251).
      const key = cat + "|" + name.toLowerCase();
      if (map.has(key)) { const e = map.get(key); e.count += +m[1]; if (set) e.prints.push(set + " " + num); continue; }
      map.set(key, {name, set, num, count:+m[1], cat, card, prints: set ? [set + " " + num] : [],
        stage: card?.stage === "Stage2" ? 2 : card?.stage === "Stage1" ? 1 : 0,
        sub: cat === "trainer" ? card.trainerType?.toLowerCase() : cat === "energy" ? (card.energyType === "Special" ? "special" : "basic") : null,
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
.side{display:flex;flex-direction:column;gap:14px;position:sticky;top:12px}
@media (max-width:900px){.side{position:static}}
.col{display:flex;flex-direction:column;gap:10px}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
textarea{width:100%;min-height:200px;resize:vertical;border:1px solid var(--line);border-radius:8px;background:var(--sunk);padding:10px;font-family:var(--f-mono);font-size:12px;line-height:1.55}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:7px 12px;font-weight:600;font-size:13px}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.cardlist{display:flex;flex-direction:column;gap:2px;max-height:52vh;overflow:auto;margin:0 -6px;padding:0 6px}
.cl-head{display:flex;justify-content:space-between;margin-top:10px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.cl-head:first-child{margin-top:0}
.cl-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 0;font-size:13px}
.cl-row .n{font-family:var(--f-mono);color:var(--muted);text-align:right}
.cl-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip{border:1px solid var(--line);background:var(--sunk);border-radius:999px;font-size:11px;padding:1px 8px;font-weight:600;white-space:nowrap}
.chip.ace{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.hint{font-size:12px;color:var(--muted);margin:0}
.stack{display:flex;flex-direction:column;gap:18px}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1100px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{background:var(--surface);border-radius:var(--r);padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.tile .big{font-family:var(--f-display);font-weight:800;font-size:32px;line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
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
.th-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
@media (max-width:1100px){.th-split{grid-template-columns:minmax(0,1fr)}}
.mull{opacity:.55}
.card{width:84px;flex:none}
.card.sm{width:60px}
/* Kaarttegel van cardTile() (cards.js); zelfde regels als .ctile in style.css, die de shadow root niet bereikt. */
.ctile{position:relative;aspect-ratio:63/88;border-radius:6px;overflow:hidden}
.ctile img{display:block;width:100%;height:100%;object-fit:cover}
.ctile:not(.ph)>span{display:none}
.ctile.ph{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);font-size:10px;line-height:1.2;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ctile .band{height:5px;flex:none}
.ctile .nm{font-weight:600;padding:4px 5px 2px;font-size:10.5px;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ctile .art{flex:1;margin:0 5px;border-radius:4px;display:grid;place-items:center;min-height:0;font:800 22px var(--f-display);letter-spacing:-.03em;color:rgba(255,255,255,.92)}
.ctile .ft{padding:3px 5px 4px;font-size:9px;color:var(--muted);text-align:center}
.card.sm .nm{font-size:8.5px}
.card.sm .art{font-size:16px}
.card.sm .ft{display:none}`;

  const MARKUP = `
<div class="layout">
  <aside class="side">
    <div class="panel col">
      <label class="label" for="deck">List (PTCG Live format)</label>
      <textarea id="deck" spellcheck="false"></textarea>
      <div class="row">
        <button class="btn primary" id="btn-parse">Check list</button>
        <button class="btn" id="btn-sample">Example</button>
      </div>
      <p class="hint" id="src"></p>
    </div>
    <div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <span class="label">In your list</span>
        <span class="num" id="total-badge"></span>
      </div>
      <div class="cardlist" id="cardlist"></div>
    </div>
  </aside>
  <main><section id="view" class="stack"></section></main>
</div>`;

  let root = null, entries = [], TH = null, srcLabel = "";
  const $ = s => root.querySelector(s);

  function renderList(){
    const total = totalOf(entries);
    const tb = $("#total-badge"); tb.textContent = total + " / 60"; tb.style.color = total === 60 ? "var(--good)" : "var(--bad)";
    let html = "";
    for (const cat of ["pokemon","trainer","energy",null]){
      const list = entries.filter(e => e.cat === cat); if (!list.length) continue;
      html += `<div class="cl-head"><span class="label" style="color:${cat ? catColor(cat) : "var(--bad)"}">${cat ? CAT_LABEL[cat] : "Not recognized"}</span><span class="num label">${count(list, () => true)}</span></div>`;
      for (const e of list){
        const tag = `<span class="chip">${cat ? tagOf(e) : "card not recognized"}</span>`;
        html += `<div class="cl-row"><span class="n">${e.count}</span><span class="nm" title="${esc(e.prints.join(", "))}">${esc(e.name)}</span><span class="row" style="gap:4px">${e.ace ? '<span class="chip ace">ACE SPEC</span>' : ""}${tag}</span></div>`;
      }
    }
    $("#cardlist").innerHTML = html || '<p class="hint">No cards recognized yet. Paste a list with lines like <span class="num">4 Applin DRI 16</span>.</p>';
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
      <div class="tile"><span class="label">Supporter on turn 1</span><span class="big">${st ? pct(st.supT[1]) : "–"}</span><span class="sub">Opening hand + 1 drawn card</span><span class="sub">${nSup} Supporters in the list</span></div>
      <div class="tile"><span class="label">Card count</span><span class="big">${total}</span><span class="pill ${total === 60 ? "good" : "bad"}">${total === 60 ? "Legal count" : "Must be 60"}</span><span class="sub">${by("pokemon")} Pokémon · ${by("trainer")} Trainer · ${by("energy")} Energy${by(null) ? ` · ${by(null)} not recognized` : ""}</span></div>
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

      const opts = sel => entries.map((e,i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(e.name)} (${e.count})</option>`).join("");
      const a0 = Math.max(0, entries.findIndex(isBasicEntry)), b0 = Math.max(0, entries.findIndex(e => e.sub === "supporter"));
      html += `<div class="panel"><div class="sec-head"><h2>Combo check</h2><p>How often do you have two cards at once? Pick the same card twice to check for 2 copies.</p></div>
        <div class="combo"><select id="cb-a" aria-label="Card A">${opts(a0)}</select><select id="cb-b" aria-label="Card B">${opts(b0)}</select>
        <select id="cb-t" aria-label="When">${["Opening hand","Turn 1","Turn 2","Turn 3","Turn 4","Turn 5"].map((l,i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="combo-out"><span class="big" id="cb-out">–</span><span class="hint" id="cb-txt"></span></div></div>`;
      const fs = firstSecond(entries); if (fs) html += fsHTML(fs);
      html += `<div class="panel"><div class="sec-head"><div><h2>Sample hand</h2><p>A shuffled deck: your opening hand after any mulligans, your 6 Prize cards and the cards you draw next.</p></div><button class="btn primary" id="th-new">New hand</button></div><div class="th" id="th-body"></div></div>`;
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
      if (hand.some(isBasic) || mulls.length >= 40){ TH = {hand, prizes: d.slice(7, 13), draws: d.slice(13, 13 + TURNS), mulls}; break; }
      mulls.push(hand);
    }
    renderHand();
  }
  function renderHand(){
    const body = $("#th-body"); if (!body || !TH) return;
    const nB = TH.hand.filter(isBasic).length;
    let h = "";
    if (TH.mulls.length) h += `<div class="th-zone"><div class="zone-t"><span class="pill bad">${TH.mulls.length} mulligan${TH.mulls.length > 1 ? "s" : ""}</span>Hands without a Basic Pokémon</div>${TH.mulls.map(m => `<div class="cards mull" style="margin-bottom:6px">${m.map(c => cardHTML(c, "sm")).join("")}</div>`).join("")}</div>`;
    h += `<div class="th-zone"><div class="zone-t">Opening hand<span class="pill info">${nB} Basic${nB === 1 ? "" : "s"}</span></div><div class="cards">${TH.hand.map(c => cardHTML(c)).join("")}</div></div>`;
    h += `<div class="th-split"><div class="th-zone"><div class="zone-t">Prize cards</div><div class="cards">${TH.prizes.map(c => cardHTML(c, "sm")).join("")}</div></div>`;
    h += `<div class="th-zone"><div class="zone-t">Next draws</div><div class="cards">${TH.draws.map((c, i) => `<div class="cw">${cardHTML(c, "sm")}<span>Turn ${i+1}</span></div>`).join("")}</div></div></div>`;
    body.innerHTML = h;
  }

  // ---------- Invoer ----------
  // Async: de Card index wordt bij het eerste gebruik geladen (één keer per pagina). Mislukt dat, dan is elke regel onbekend.
  async function load(){
    const text = $("#deck").value;
    try { localStorage.setItem("decklab.deck", text); localStorage.setItem("decklab.src", srcLabel); } catch {}
    $("#src").textContent = srcLabel;
    const index = await loadCardIndex();
    entries = parse(text, index);
    TH = null; renderList(); renderAnalysis();
  }
  function mount(host, skipLoad = false){
    if (root) return;
    root = host.attachShadow({mode: "open"});
    root.innerHTML = `<style>${CSS}</style>${MARKUP}`;
    $("#btn-parse").onclick = load;
    $("#btn-sample").onclick = () => { $("#deck").value = SAMPLE; srcLabel = "Example list"; load(); };
    let deb; $("#deck").addEventListener("input", () => {
      if (srcLabel && !srcLabel.endsWith("(edited)")) srcLabel += " (edited)";
      clearTimeout(deb); deb = setTimeout(load, 600);
    });
    let saved = null;
    try { saved = localStorage.getItem("decklab.deck"); srcLabel = localStorage.getItem("decklab.src") || ""; } catch {}
    // Labels die eerder in het Nederlands zijn bewaard.
    srcLabel = srcLabel.replace(/^Voorbeeldlijst/, "Example list").replace(/ \(aangepast\)$/, " (edited)")
      .replace(/ · aanbevolen lijst uit Matchup Meta/, " · recommended list from Matchup Meta").replace(/ · consensuslijst uit Matchup Meta/, " · consensus list from Matchup Meta");
    if (!saved) srcLabel = "Example list";
    $("#deck").value = saved || SAMPLE;
    if (!skipLoad) load();
  }
  function open(host, text, label){
    mount(host, true);
    srcLabel = label; $("#deck").value = text; load();
  }
  return { mount, open, quick };
})();
