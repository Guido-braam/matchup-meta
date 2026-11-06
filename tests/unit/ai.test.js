// The AI module, on a stand-in for fetch: no real API calls, no key needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAI } from "../../site/js/ai.js";

const KEY = "sk-ant-test-key";
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };

// A fetch that records each call and answers with the given status and JSON body.
function fakeFetch(status, body) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  f.calls = calls;
  return f;
}
// A Messages API answer with one text block.
const message = (text, extra = {}) => ({
  type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }], ...extra,
});
const apiError = (type, msg) => ({ type: "error", error: { type, message: msg }, request_id: "req_1" });

test("a JSON request goes straight to the Messages API from the browser with the visitor's key", async () => {
  const f = fakeFetch(200, message('{"summary":"Play Dragapult."}'));
  await createAI(KEY, { fetch: f }).json("Which deck?", SCHEMA);

  assert.equal(f.calls.length, 1);
  const { url, init, body } = f.calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "content-type": "application/json",
    "x-api-key": KEY,
    "anthropic-version": "2026-10-21",
    "anthropic-dangerous-direct-browser-access": "true",
  });
  assert.deepEqual(body, {
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: "Which deck?" }],
  });
});

test("the structured answer comes back as an object", async () => {
  const ai = createAI(KEY, { fetch: fakeFetch(200, message('{"summary":"Play Dragapult."}')) });
  assert.deepEqual(await ai.json("Which deck?", SCHEMA), { summary: "Play Dragapult." });
});

// What went wrong, as a code the page turns into a sentence; the API's own message rides along.
const failure = async (fetch, code) => {
  await assert.rejects(createAI(KEY, { fetch }).json("Which deck?", SCHEMA), e => {
    assert.equal(e.code, code);
    return true;
  });
};

test("a rejected key fails with invalid_key", async () => {
  await failure(fakeFetch(401, apiError("authentication_error", "invalid x-api-key")), "invalid_key");
});

test("each kind of failed request has its own code", async () => {
  const cases = [
    [401, "authentication_error", "CORS requests are not allowed for this Organization because of its settings.", "browser_blocked"],
    [402, "billing_error", "Your credit balance is too low.", "billing"],
    [403, "permission_error", "Your API key does not have permission.", "forbidden"],
    [404, "not_found_error", "model: claude-opus-5-5", "model_unavailable"],
    [413, "request_too_large", "Request exceeds the maximum size.", "too_large"],
    [429, "rate_limit_error", "Number of requests has exceeded your rate limit.", "rate_limited"],
    [500, "api_error", "Internal server error.", "server"],
    [529, "overloaded_error", "Overloaded.", "overloaded"],
    [400, "invalid_request_error", "messages: field required", "bad_request"],
  ];
  for (const [status, type, msg, code] of cases) await failure(fakeFetch(status, apiError(type, msg)), code);
});

test("no connection fails with network, and stopping fails with cancelled", async () => {
  // fetch rejects with a TypeError when the request never gets an answer (offline, blocked).
  await failure(async () => { throw new TypeError("Failed to fetch"); }, "network");
  const ctl = new AbortController();
  const hanging = (url, init) => new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError"))));
  const run = createAI(KEY, { fetch: hanging }).json("Which deck?", SCHEMA, { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(run, e => e.code === "cancelled");
});

test("an answer that cannot be used fails with refused, truncated or invalid_json", async () => {
  await failure(fakeFetch(200, message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null } })), "refused");
  await failure(fakeFetch(200, message('{"summary":"Play Drag', { stop_reason: "max_tokens" })), "truncated");
  await failure(fakeFetch(200, message("Play Dragapult.")), "invalid_json");
});

// Deck chat: a streamed answer (server-sent events), with a tool Claude may call before it answers.
// A server-sent event as the Messages API writes it.
const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
// The events of one streamed assistant message: a thinking block, then the given blocks, then the stop reason.
function events(blocks, stop_reason = "end_turn") {
  const ev = [{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], stop_reason: null } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
    { type: "content_block_stop", index: 0 }, { type: "ping" }];
  blocks.forEach((b, j) => {
    const index = j + 1;
    if (b.text != null) {
      ev.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      // In two pieces, so the page sees the answer grow.
      const half = Math.ceil(b.text.length / 2);
      for (const t of [b.text.slice(0, half), b.text.slice(half)]) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: t } });
    } else {
      ev.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      for (const part of [json.slice(0, 5), json.slice(5)]) ev.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: part } });
    }
    ev.push({ type: "content_block_stop", index });
  });
  ev.push({ type: "message_delta", delta: { stop_reason }, usage: { output_tokens: 10 } }, { type: "message_stop" });
  return ev;
}
const streamed = (blocks, stop_reason) => sse(events(blocks, stop_reason));
// The events up to and including the first piece of text.
const upToFirstText = blocks => { const ev = events(blocks); return ev.slice(0, ev.findIndex(e => e.delta?.type === "text_delta") + 1); };
// A fetch that answers each call with the next streamed body (or [status, json] for a failed request).
function fakeStream(...bodies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = bodies[calls.length - 1];
    if (Array.isArray(next)) return new Response(JSON.stringify(next[1]), { status: next[0], headers: { "content-type": "application/json" } });
    return new Response(next, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  f.calls = calls;
  return f;
}
const SYSTEM = "You are a coach. The deck: Dragapult.";

test("a Deck chat answer streams in, with the deck's context as the system prompt", async () => {
  const f = fakeStream(streamed([{ text: "Play 4 Dreepy." }]));
  const seen = [];
  const res = await createAI(KEY, { fetch: f }).chat({ system: SYSTEM, messages: [{ role: "user", content: "How many Dreepy?" }], onText: t => seen.push(t) });

  assert.deepEqual(res, { text: "Play 4 Dreepy.", truncated: false });
  assert.deepEqual(seen, ["Play 4 ", "Play 4 Dreepy."]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.headers["x-api-key"], KEY);
  assert.equal(f.calls[0].init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.deepEqual(f.calls[0].body, {
    model: "claude-opus-5-5",
    max_tokens: 64000,
    stream: true,
    system: SYSTEM,
    messages: [{ role: "user", content: "How many Dreepy?" }],
    output_config: { effort: "medium" },
  });
});

// The list-check tool as Deck chat defines it, with run() recording what Claude asked for.
const checkList = (answer = { total: 60, problems: [] }) => {
  const runs = [];
  return { runs, tool: { name: "check_list", description: "Checks a 60-card list.",
    input_schema: { type: "object", properties: { cards: { type: "array" } }, required: ["cards"] },
    run: input => { runs.push(input); return answer; } } };
};
const LIST = { cards: [{ count: 4, name: "Dreepy", set: "TWM", number: "128" }] };

test("Claude can call a tool, gets its result, and then answers", async () => {
  const f = fakeStream(
    streamed([{ id: "toolu_1", name: "check_list", input: LIST }], "tool_use"),
    streamed([{ text: "The list checks out." }]));
  const { runs, tool } = checkList();
  const seen = [];
  const res = await createAI(KEY, { fetch: f }).chat({ system: SYSTEM, messages: [{ role: "user", content: "Build a list." }], tools: [tool], onText: t => seen.push(t) });

  assert.deepEqual(runs, [LIST]);
  assert.deepEqual(res, { text: "The list checks out.", truncated: false });
  assert.equal(seen.at(-1), "The list checks out.");
  assert.equal(f.calls.length, 2);
  // The tool goes out without its run function.
  assert.deepEqual(f.calls[0].body.tools, [{ name: "check_list", description: "Checks a 60-card list.", input_schema: tool.input_schema }]);
  // The second request replays Claude's turn unchanged (thinking block and signature included), then the tool result.
  assert.deepEqual(f.calls[1].body.messages, [
    { role: "user", content: "Build a list." },
    { role: "assistant", content: [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "toolu_1", name: "check_list", input: LIST },
    ] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify({ total: 60, problems: [] }) }] },
  ]);
});

test("a tool that fails or gets unreadable input reports an error to Claude instead of stopping the chat", async () => {
  const broken = sse([
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [] } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_2", name: "check_list", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"cards": [' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" }]);
  const f = fakeStream(
    streamed([{ id: "toolu_1", name: "check_list", input: { cards: "four Dreepy" } }], "tool_use"),
    broken,
    streamed([{ text: "Here is the list." }]));
  const tool = { ...checkList().tool, run: input => { if (!Array.isArray(input.cards)) throw new Error("cards must be a list"); } };
  const res = await createAI(KEY, { fetch: f }).chat({ system: SYSTEM, messages: [{ role: "user", content: "Build a list." }], tools: [tool] });

  assert.equal(res.text, "Here is the list.");
  assert.deepEqual(f.calls[1].body.messages.at(-1).content,
    [{ type: "tool_result", tool_use_id: "toolu_1", content: "cards must be a list", is_error: true }]);
  assert.equal(f.calls[2].body.messages.at(-1).content[0].is_error, true);
});

const chatFails = (fetch, code, text, signal) => assert.rejects(
  createAI(KEY, { fetch }).chat({ system: SYSTEM, messages: [{ role: "user", content: "How many Dreepy?" }], signal }), e => {
    assert.equal(e.code, code);
    assert.equal(e.text ?? "", text);
    return true;
  });

test("a failed Deck chat request has the same codes, and keeps what was already written", async () => {
  await chatFails(fakeStream([401, apiError("authentication_error", "invalid x-api-key")]), "invalid_key", "");
  // An error event in the middle of the stream, after part of the answer arrived.
  await chatFails(fakeStream(sse([...upToFirstText([{ text: "Play 4 Dreepy." }]),
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }])), "overloaded", "Play 4 ");
  await chatFails(fakeStream(streamed([{ text: "I can't" }], "refusal")), "refused", "I can't");
});

test("Stop during a streamed answer fails with cancelled and keeps the text so far", async () => {
  const ctl = new AbortController();
  // A stream that sends the first piece of text and then waits until it is aborted.
  const hanging = async (url, init) => {
    const first = sse(upToFirstText([{ text: "Play 4 Dreepy." }]));
    const body = new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(first));
      init.signal.addEventListener("abort", () => c.error(new DOMException("The operation was aborted.", "AbortError")));
    } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const run = chatFails(hanging, "cancelled", "Play 4 ", ctl.signal);
  await new Promise(r => setTimeout(r, 20));
  ctl.abort();
  await run;
});
