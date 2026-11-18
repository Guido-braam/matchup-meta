// Game-state engine (spec .scratch/battle-logs, ticket 06): a parsed battle log -> one board state per event.
// Pure. Used by the replay and by insights that need the board ("Knock Out on turn 1").
//
// A state: {turn, turnSide, uncertain, stadium, me: Side, opp: Side}
//   Side: {active: Mon|null, bench: [Mon], prizes, handCount, deck, discard, hand: [names known]}
//   Mon:  {uid, name, id?, damage, energy: [names], tools: [names], stack: [names it evolved from]}
// hand holds the names I know: all of mine that the log names, none of the opponent's (only revealed ones).
// Counts (hand, deck, discard) follow the log and can drift from the real game where it says nothing,
// for example a card put back by an effect the log does not spell out.
//
// The log is not always right about owners: "X put N damage counters on Y's Z" often names the wrong player,
// so that owner is decided from the board. Two Pokémon with the same name on one side can't be told apart in
// some lines; the engine then picks the first and marks the state uncertain.

const newSide = () => ({ active: null, bench: [], prizes: 6, handCount: 0, deck: 60, discard: 0, hand: [] });
const isEnergy = name => /Energy$/.test(name);
const other = s => (s === "me" ? "opp" : "me");

export function replay(game) {
  let uid = 0;
  const st = { turn: 0, turnSide: null, uncertain: false, stadium: null, me: newSide(), opp: newSide() };
  const out = [];
  const mon = c => ({ uid: ++uid, name: c.name, ...(c.id ? { id: c.id } : {}), damage: 0, energy: [], tools: [], stack: [] });
  const inPlay = s => [st[s].active, ...st[s].bench].filter(Boolean);
  // A Pokémon by name: only in `at` if given ("Active Spot" | "Bench"), else Active first. Among several with the
  // name, `prefer` sorts the likeliest first; when they differ and none is clearly it, the state is uncertain.
  const find = (s, name, at, prefer = null) => {
    const act = st[s].active?.name === name ? [st[s].active] : [], bench = st[s].bench.filter(m => m.name === name);
    let all = at === "Bench" ? bench : at === "Active Spot" ? act : [...act, ...bench];
    if (prefer) all = [...all].sort(prefer);
    if (all.length > 1 && new Set(all.map(m => m.damage + "|" + m.energy.join())).size > 1 && !(prefer && prefer(all[0], all[1]) < 0)) st.uncertain = true;
    return all[0] ?? null;
  };
  const known = (s, names) => { if (s === "me") st.me.hand.push(...names); };
  const unknown = (s, name) => { const h = st[s].hand, k = h.indexOf(name); if (k >= 0) h.splice(k, 1); };
  const fromHand = (s, name, n = 1) => { st[s].handCount -= n; if (name) unknown(s, name); };
  const toPlay = (s, c, where) => {
    const m = mon(c);
    if (where === "Active Spot" && !st[s].active) st[s].active = m; else st[s].bench.push(m);
  };
  const remove = (s, m) => {
    if (st[s].active === m) st[s].active = null; else st[s].bench = st[s].bench.filter(x => x !== m);
    st[s].discard += 1 + m.energy.length + m.tools.length + m.stack.length;
  };

  for (const e of game.events) {
    st.turn = e.turn; st.turnSide = e.turnSide; st.uncertain = false;
    const s = e.side, names = (e.cards || []).map(c => c.name);
    switch (e.type) {
      case "opening": st[s].handCount = 7; st[s].deck = 60 - 7 - 6; break; // Prize cards are set aside at setup
      case "drawn": if (e.cards) known("me", names); break; // my opening hand
      case "draw": st[s].deck -= e.count; st[s].handCount += e.count; known(s, names); break;
      case "play":
        fromHand(s, e.card.name);
        if (e.to === "Bench" || e.to === "Active Spot") toPlay(s, e.card, e.to);
        else if (e.to === "Stadium spot") { if (st.stadium) st[st.stadium.side].discard++; st.stadium = { side: s, name: e.card.name }; }
        else st[s].discard++; // an Item or Supporter
        break;
      case "search-play":
        st[s].deck -= e.count;
        (e.cards || []).forEach(c => toPlay(s, c, e.to));
        break;
      case "evolve": {
        fromHand(s, e.card.name);
        const m = find(s, e.from.name, e.at);
        if (m) { m.stack.push(m.name); m.name = e.card.name; if (e.card.id) m.id = e.card.id; else delete m.id; } else st.uncertain = true;
        break;
      }
      case "attach": {
        // A plain attach is from the hand; one under another card (Crispin) comes from the deck.
        if (e.sub) st[s].deck--; else fromHand(s, e.card.name);
        const m = find(s, e.pokemon.name, e.at);
        if (m) (isEnergy(e.card.name) ? m.energy : m.tools).push(e.card.name); else st.uncertain = true;
        break;
      }
      case "retreat": if (st[s].active) { st[s].bench.push(st[s].active); st[s].active = null; } break;
      case "active": {
        const m = st[s].bench.find(x => x.name === e.pokemon.name);
        if (st[s].bench.filter(x => x.name === e.pokemon.name).length > 1) st.uncertain = true;
        if (!m) break;
        st[s].bench = st[s].bench.filter(x => x !== m);
        if (st[s].active) st[s].bench.push(st[s].active);
        st[s].active = m;
        break;
      }
      case "switch": if (e.pokemon.name === e.with?.pokemon.name) st.uncertain = true; break;
      case "attack":
        if (e.target && e.damage) {
          const m = find(e.target.side, e.target.pokemon.name, "Active Spot") ?? find(e.target.side, e.target.pokemon.name);
          if (m) m.damage += e.damage;
        }
        break;
      case "counters": {
        // Ignore the owner in the text: the side that has a Pokémon with that name. Both do -> trust the text, uncertain.
        const name = e.target.pokemon.name, has = ["me", "opp"].filter(x => inPlay(x).some(m => m.name === name));
        const side = has.length === 1 ? has[0] : (e.target.side ?? other(s));
        if (has.length > 1) st.uncertain = true;
        // Several with that name: the one with the least damage (Risky Ruins hits each new Basic once).
        const m = find(side, name, null, (a, b) => a.damage - b.damage);
        if (m) m.damage += e.count * 10;
        break;
      }
      case "ko": { const m = find(s, e.pokemon.name); if (m) remove(s, m); else st.uncertain = true; break; }
      case "prize": st[s].prizes -= e.count; st[s].handCount += e.count; break;
      case "to-hand": known(s, names); break; // the cards are counted where they came from (a Prize card)
      case "discard":
        if (e.from) {
          // The Pokémon that carries those cards (after a Knock Out it is gone, and the cards were counted then).
          const has = m => names.filter(n => m.energy.includes(n) || m.tools.includes(n)).length;
          const m = find(e.from.side, e.from.pokemon.name, null, (a, b) => has(b) - has(a));
          for (const n of names) if (m) { const k = m.energy.indexOf(n); if (k >= 0) m.energy.splice(k, 1); else { const t = m.tools.indexOf(n); if (t >= 0) m.tools.splice(t, 1); } }
          if (m) st[e.from.side].discard += names.length || e.count;
        } else { st[s].handCount -= e.count; st[s].discard += e.count; names.forEach(n => unknown(s, n)); }
        break;
      case "shuffle-in": st[s].handCount -= e.count; st[s].deck += e.count; names.forEach(n => unknown(s, n)); break;
    }
    out.push(snapshot(st));
  }
  return out;
}

const snapSide = s => ({ ...s, active: s.active && { ...s.active, energy: [...s.active.energy], tools: [...s.active.tools], stack: [...s.active.stack] },
  bench: s.bench.map(m => ({ ...m, energy: [...m.energy], tools: [...m.tools], stack: [...m.stack] })), hand: [...s.hand] });
const snapshot = st => ({ turn: st.turn, turnSide: st.turnSide, uncertain: st.uncertain,
  stadium: st.stadium && { ...st.stadium }, me: snapSide(st.me), opp: snapSide(st.opp) });
