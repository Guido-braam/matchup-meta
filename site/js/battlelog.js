// Battle log parser: the text Pokémon TCG Live gives after a game -> a Game record (spec .scratch/battle-logs).
// Pure: text and Card index in, {ok, game} or {ok: false, problems} out.
// Format knowledge partly from the MIT-licensed Full Bench parser (github.com/heatfireash/FullBench); ideas, not code.
//
// Format facts that are easy to get wrong:
// - No turn numbers: a turn starts at a bare "Name's Turn" line.
// - Straight and curly apostrophes both occur; we read everything with straight ones.
// - Player names can contain digits and apostrophes, so lines are matched on the two known names, longest first.
// - Blank lines may or may not be there. A bullet line (•) belongs to the nearest line above it.
// - Some logs put the game's card code before every card: "(me1_104) Mega Kangaskhan ex".
// - The log is written from one player's side: their turn-start draw names the card, the other's says "a card".
// - "X put N damage counters on Y's Z" often names the wrong owner; this parser keeps the text, gamestate.js decides.

// Bump when a change should apply to games already saved: they are read again from their raw log.
// 2: attach and evolve keep where it happened (at: "Active Spot" | "Bench").
// 3: every event keeps its line as `text` (bullet lines added below it), for the replay's log.
export const PARSER_VERSION = 3;

const CODE_RE = /^\(([a-z0-9]+(?:-[a-z0-9]+)*_\d+[a-z]?(?:_[a-z0-9]+)*)\)\s*/i;

// Game card code -> Card index id, or null. "me1_104" -> "me01-104", "sv8-5_79_mph" -> "sv08.5-079",
// "rsv10-5_84" -> "sv10.5w-084" (r = White Flare, z = Black Bolt). Only ids that are in the index count.
export function cardIdFromCode(code, index) {
  if (!index) return null;
  const m = /^([rz]?)([a-z]+)(\d*)(?:-(\d+))?_(\d+)/i.exec(code);
  if (!m) return null;
  const [, half, series, n, dot, num] = m;
  const set = (pre = "") => `${pre}${series}${n ? n.padStart(2, "0") : ""}${dot ? "." + dot : ""}`;
  const local = num.padStart(3, "0");
  const ids = [`${set()}${half === "r" ? "w" : half === "z" ? "b" : ""}-${local}`, `${set(half)}-${local}`];
  return ids.find(id => index.cards?.[id]) ?? null;
}

// "(me1_104) Mega Kangaskhan ex" -> {id, name}; without a code or an unknown one -> {name}.
function cardRef(text, index) {
  const m = CODE_RE.exec(text);
  const name = (m ? text.slice(m[0].length) : text).trim();
  const id = m && cardIdFromCode(m[1], index);
  return id ? { id, name } : { name };
}

const num = s => (s === "a" || s === "an" ? 1 : Number(s));

export function parseLog(raw, index = null) {
  const text = String(raw ?? "").normalize("NFC").replace(/’/g, "'").replace(/\r\n?/g, "\n");
  if (text.trim().length < 300) return { ok: false, problems: ["too short to be a battle log"] };
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Players: the two opening hands, else the turn headers.
  const names = [];
  const addName = n => { if (n && !names.includes(n)) names.push(n); };
  for (const l of lines) addName(/^(.+) drew 7 cards for the opening hand\.$/.exec(l)?.[1]);
  if (names.length < 2) for (const l of lines) addName(/^(.+)'s Turn$/.exec(l)?.[1]);
  const problems = [];
  if (!lines.includes("Setup")) problems.push("no Setup section");
  if (names.length !== 2) problems.push(`expected 2 players, found ${names.length}`);
  const last = lines[lines.length - 1] || "";
  const winM = / wins\.$/.test(last) ? /(?:^|\. )([^.]+?) wins\.$/.exec(last) : null;
  if (!winM) problems.push("no result line - was the whole log copied?");
  if (lines.filter(l => l.endsWith(" drew 7 cards for the opening hand.")).length !== 2)
    problems.push("opening hands not drawn for both players");
  if (problems.length) return { ok: false, problems };

  const longest = [...names].sort((a, b) => b.length - a.length);
  const me = whoseLog(lines, names), opp = names.find(n => n !== me);
  const side = n => (n === me ? "me" : n === opp ? "opp" : null);
  // "Name's rest" -> {side, rest}; "Name rest" -> the same with possessive false.
  const owned = s => { for (const n of longest) if (s.startsWith(n + "'s ")) return { side: side(n), rest: s.slice(n.length + 3) }; return null; };
  const actor = s => { for (const n of longest) if (s.startsWith(n + " ")) return { side: side(n), rest: s.slice(n.length + 1) }; return null; };
  const ref = s => cardRef(s, index);
  const mon = s => { const o = owned(s); return o ? { side: o.side, pokemon: ref(o.rest) } : { side: null, pokemon: ref(s) }; };

  const game = {
    players: { me, opp }, wentFirst: null, coinWinner: null, result: null, reason: null,
    turns: 0, prizes: { me: 0, opp: 0 }, mulligans: { me: 0, opp: 0 }, openingHand: [], events: [],
  };
  let turn = 0, turnSide = null;
  const sideTurns = { me: 0, opp: 0 };
  let host = null; // the event a bullet line adds its cards to

  for (const line of lines) {
    if (line.startsWith("•")) {
      const body = line.replace(/^•\s*/, "");
      if (host) host.text += "\n• " + body;
      if (host?.type === "breakdown") host.lines.push(body);
      else if (host) host.cards = (host.cards || []).concat(body.split(", ").map(ref));
      continue;
    }
    const sub = line.startsWith("- ");
    const s = sub ? line.slice(2) : line;
    const e = { turn, turnSide, sideTurn: turnSide ? sideTurns[turnSide] : 0, sub, ...read(s), text: s };
    if (e.type === "turn") {
      turn++; turnSide = e.side; sideTurns[e.side]++; game.turns++;
      host = null;
      continue;
    }
    if (e.type === "setup") { host = null; continue; }
    game.events.push(e);
    host = e;
    if (e.type === "first") game.wentFirst = (e.side === "me") === e.first;
    if (e.type === "coin") game.coinWinner = e.side;
    if (e.type === "prize") game.prizes[e.side] += e.count;
    if (e.type === "mulligan") game.mulligans[e.side] = Math.max(game.mulligans[e.side], e.count);
    if (e.type === "result") { game.result = e.winner === "me" ? "win" : "loss"; game.reason = e.reason; }
  }
  // My opening hand: the bullet under "- 7 drawn cards." after my "drew 7 cards for the opening hand.".
  const oi = game.events.findIndex(e => e.type === "opening" && e.side === "me");
  game.openingHand = game.events.slice(oi + 1).find(e => e.type === "drawn")?.cards || [];

  if (game.prizes.me > 6 || game.prizes.opp > 6) problems.push("prize count outside 0-6");
  if (game.reason === "prizes" && game.prizes[game.result === "win" ? "me" : "opp"] !== 6)
    problems.push("won on prizes without taking six");
  return problems.length ? { ok: false, problems } : { ok: true, game };

  // One line (without "- ") -> event fields. Unknown lines become {type: "other", text}.
  function read(s) {
    let m;
    if (s === "Setup") return { type: "setup" };
    const o = owned(s);
    if (o) {
      const r = o.rest;
      if (r === "Turn") return { type: "turn", side: o.side };
      if ((m = /^(.+) is now in the Active Spot\.$/.exec(r))) return { type: "active", side: o.side, pokemon: ref(m[1]) };
      if ((m = /^(.+?) used (.+?) on (.+) for ([\d,]+) damage\.$/.exec(r)))
        return { type: "attack", side: o.side, pokemon: ref(m[1]), attack: m[2], target: mon(m[3]), damage: Number(m[4].replace(/,/g, "")) };
      if ((m = /^(.+?) used (.+?)\.$/.exec(r))) return { type: "attack", side: o.side, pokemon: ref(m[1]), attack: m[2], damage: null };
      if ((m = /^(.+) was Knocked Out!$/.exec(r))) return { type: "ko", side: o.side, pokemon: ref(m[1]) };
      if ((m = /^(.+) was switched with (.+) to become the Active Pok[eé]mon\.$/.exec(r)))
        return { type: "switch", side: o.side, pokemon: ref(m[1]), with: mon(m[2]) };
    }
    const a = actor(s);
    if (a) {
      const r = a.rest, side = a.side;
      if (/^drew \d+ cards for the opening hand\.$/.test(r)) return { type: "opening", side };
      if (r === "drew a card.") return { type: "draw", side, count: 1 };
      if ((m = /^drew (\d+) cards and played them to the (Bench|Active Spot)\.$/.exec(r))) return { type: "search-play", side, count: num(m[1]), to: m[2] };
      if ((m = /^drew (.+) and played it to the (Bench|Active Spot)\.$/.exec(r))) return { type: "search-play", side, count: 1, to: m[2], cards: [ref(m[1])] };
      if ((m = /^drew (\d+) more cards? because .+ took at least 1 mulligan\.$/.exec(r))) return { type: "draw", side, count: num(m[1]), mulligan: true };
      if ((m = /^drew (\d+) cards?\.$/.exec(r))) return { type: "draw", side, count: num(m[1]) };
      if ((m = /^drew (.+)\.$/.exec(r))) return { type: "draw", side, count: 1, cards: [ref(m[1])] };
      if ((m = /^played (.+) to the (Bench|Active Spot|Stadium spot)\.$/.exec(r))) return { type: "play", side, card: ref(m[1]), to: m[2] };
      if ((m = /^played (.+)\.$/.exec(r))) return { type: "play", side, card: ref(m[1]) };
      if ((m = /^attached (.+) to (.+) (?:in|on) the (Active Spot|Bench)\.$/.exec(r))) return { type: "attach", side, card: ref(m[1]), pokemon: ref(m[2]), at: m[3] };
      if ((m = /^evolved (.+) to (.+) (?:in|on) the (Active Spot|Bench)\.$/.exec(r))) return { type: "evolve", side, from: ref(m[1]), card: ref(m[2]), at: m[3] };
      if ((m = /^retreated (.+) to the Bench\.$/.exec(r))) return { type: "retreat", side, pokemon: ref(m[1]) };
      if ((m = /^took (a|\d+) Prize cards?\.$/.exec(r))) return { type: "prize", side, count: num(m[1]) };
      if ((m = /^took (a|\d+) mulligans?\.$/.exec(r))) return { type: "mulligan", side, count: num(m[1]) };
      if ((m = /^put (\d+) damage counters? on (.+)\.$/.exec(r))) return { type: "counters", side, count: num(m[1]), target: mon(m[2]) };
      if ((m = /^discarded (\d+) cards?\.$/.exec(r))) return { type: "discard", side, count: num(m[1]) };
      if ((m = /^discarded (.+)\.$/.exec(r))) return { type: "discard", side, count: 1, cards: [ref(m[1])] };
      if ((m = /^shuffled (a|\d+) cards? into their deck\.$/.exec(r))) return { type: "shuffle-in", side, count: num(m[1]) };
      if (r === "shuffled their deck.") return { type: "shuffle", side };
      if ((m = /^flipped a coin and it landed on (heads|tails)\.$/.exec(r))) return { type: "flip", side, heads: m[1] === "heads" };
      if ((m = /^chose (heads|tails) for the opening coin flip\.$/.exec(r))) return { type: "call", side, heads: m[1] === "heads" };
      if (r === "won the coin toss.") return { type: "coin", side };
      if ((m = /^decided to go (first|second)\.$/.exec(r))) return { type: "first", side, first: m[1] === "first" };
      if (r === "ended their turn.") return { type: "end", side };
    }
    if ((m = /(?:^|\. )([^.]+?) wins\.$/.exec(s)) && side(m[1])) {
      const reason = /conceded\./.test(s) ? "concede" : /took all of their Prize cards/.test(s) ? "prizes" : "other";
      return { type: "result", side: null, winner: side(m[1]), reason, text: s };
    }
    if ((m = /^(.+) was added to (.+)'s hand\.$/.exec(s)))
      return { type: "to-hand", side: side(m[2]), cards: m[1] === "A card" ? [] : [ref(m[1])] };
    if ((m = /^(\d+) cards were discarded from (.+)\.$/.exec(s))) return { type: "discard", count: num(m[1]), from: mon(m[2]), side: mon(m[2]).side };
    if ((m = /^(.+) was discarded from (.+)\.$/.exec(s))) return { type: "discard", count: 1, cards: [ref(m[1])], from: mon(m[2]), side: mon(m[2]).side };
    if ((m = /^(.+) was activated\.$/.exec(s))) return { type: "activated", side: null, card: ref(m[1]) };
    if ((m = /^(\d+) drawn cards\.$/.exec(s))) return { type: "drawn", side: null, count: num(m[1]) };
    if (s === "Damage breakdown:") return { type: "breakdown", side: null, lines: [] };
    return { type: "other", side: null, text: s };
  }
}

// Whose client wrote the log: the player whose turn-start draws name the card (the other's say "a card").
// Draws in the middle of a turn can be public, so they do not count. Fallback: whose opening hand is listed.
function whoseLog(lines, names) {
  const named = Object.fromEntries(names.map(n => [n, 0]));
  lines.forEach((l, i) => {
    const n = names.find(n => l === `${n}'s Turn`);
    const next = n && lines[i + 1];
    if (next && next !== `${n} drew a card.` && next.startsWith(`${n} drew `)) named[n]++;
  });
  const best = names.reduce((a, b) => (named[b] > named[a] ? b : a));
  if (named[best]) return best;
  const oi = lines.findIndex((l, i) => l.startsWith("•") && /drawn cards\.$/.test(lines[i - 1] || ""));
  return names.find(n => lines[oi - 2]?.startsWith(`${n} drew 7 cards`)) ?? names[0];
}
