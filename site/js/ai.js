// AI module: roept de Anthropic Messages API rechtstreeks vanuit de browser aan met de eigen API key
// van de bezoeker (ADR 0002). Geen backend, geen SDK: één fetch per verzoek.
// Request-vorm volgens de Claude API-referentie: anthropic-version 2026-10-21, effort in output_config,
// en de header die directe toegang vanuit de browser (CORS) toestaat.
export const API_URL = "https://api.anthropic.com/v1/messages";
export const MODEL = "claude-opus-5-5";

// Fout met een code die de pagina in een zin omzet; message is de tekst van de API zelf.
export class AIError extends Error {
  constructor(code, message = code, status = null) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.status = status;
  }
}

// HTTP-status van een mislukt verzoek -> code. Een geldige key van een organisatie die geen
// browserverzoeken toestaat (bijv. zero data retention) geeft ook 401, met een eigen melding.
const STATUS_CODES = { 400: "bad_request", 401: "invalid_key", 402: "billing", 403: "forbidden", 404: "model_unavailable",
  413: "too_large", 429: "rate_limited", 529: "overloaded" };
function errorFor(status, body) {
  const msg = body?.error?.message || `HTTP ${status}`;
  if (status === 401 && /^CORS requests are not allowed/i.test(msg)) return new AIError("browser_blocked", msg, status);
  return new AIError(STATUS_CODES[status] || (status >= 500 ? "server" : "failed"), msg, status);
}

// Mislukt verzoek zonder antwoord: gestopt door de bezoeker, of geen verbinding (offline, geblokkeerd).
const failed = (e, signal) => new AIError(e?.name === "AbortError" || signal?.aborted ? "cancelled" : "network", e?.message);
// Fouttype in een error-event midden in een stream -> de HTTP-status die bij dat type hoort.
const STATUS_BY_TYPE = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, invalid_request_error: 400,
  authentication_error: 401, billing_error: 402, permission_error: 403, not_found_error: 404, request_too_large: 413 };

// fetch: alleen te vervangen in tests.
export function createAI(apiKey, { fetch: doFetch = (...a) => globalThis.fetch(...a) } = {}) {
  // POST naar de Messages API; params worden over de standaardwaarden gelegd. Geeft de Response bij succes.
  async function post(params, max_tokens, signal) {
    const { output_config, ...rest } = params;
    const body = { model: MODEL, max_tokens, ...rest, output_config: { effort: "medium", ...output_config } };
    let res;
    try {
      res = await doFetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2026-10-21",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw failed(e, signal);
    }
    if (!res.ok) throw errorFor(res.status, await res.json().catch(() => null));
    return res;
  }

  // Eén Messages-verzoek. Geeft het antwoord als object.
  async function send(params, { signal } = {}) {
    const res = await post(params, 16000, signal);
    return res.json().catch(() => null);
  }

  // Eén gestreamd Messages-verzoek (server-sent events). onText krijgt bij elk stukje tekst het antwoord
  // tot nu toe; geeft het hele bericht terug, met de blokken zoals de API ze stuurde (ook thinking).
  async function stream(params, { signal, onText } = {}) {
    const res = await post({ ...params, stream: true }, 64000, signal);
    const msg = { content: [], stop_reason: null };
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", text = "";
    const handle = ev => {
      if (ev.type === "error") throw errorFor(STATUS_BY_TYPE[ev.error?.type] || 500, ev);
      if (ev.type === "content_block_start") msg.content[ev.index] = { ...ev.content_block };
      else if (ev.type === "content_block_delta") {
        const b = msg.content[ev.index], d = ev.delta;
        if (d.type === "text_delta") { b.text += d.text; text += d.text; onText?.(text); }
        else if (d.type === "thinking_delta") b.thinking += d.thinking;
        else if (d.type === "signature_delta") b.signature = d.signature;
        else if (d.type === "input_json_delta") b.json = (b.json || "") + d.partial_json;
      } else if (ev.type === "content_block_stop") {
        const b = msg.content[ev.index];
        // Tool-invoer komt in stukjes JSON; kapotte invoer wordt bad_input, zodat de tool hem niet uitvoert.
        if (b?.type === "tool_use" && "json" in b) {
          try { b.input = JSON.parse(b.json || "{}"); } catch { b.bad_input = true; }
          delete b.json;
        }
      } else if (ev.type === "message_delta") msg.stop_reason = ev.delta?.stop_reason ?? msg.stop_reason;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value.replace(/\r/g, "");
        let k;
        while ((k = buf.indexOf("\n\n")) >= 0) {
          const data = buf.slice(0, k).split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
          buf = buf.slice(k + 2);
          if (data) handle(JSON.parse(data));
        }
      }
    } catch (e) {
      throw e instanceof AIError ? e : failed(e, signal);
    }
    return msg;
  }

  // Deck chat: een gestreamd antwoord, met tools die Claude mag aanroepen voordat hij antwoordt.
  // tools: [{name, description, input_schema, run(input)}]; onText krijgt de tekst van het hele antwoord tot nu toe.
  async function chat({ system, messages, tools = [], onText, signal }) {
    const defs = tools.length ? { tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })) } : {};
    messages = [...messages];
    let text = "";
    // ponytail: hooguit 8 rondes met tools; daarna telt het antwoord als afgekapt.
    for (let round = 0; round < 8; round++) {
      const before = text;
      let res;
      try {
        res = await stream({ system, messages, ...defs }, { signal, onText: t => { text = before + t; onText?.(text); } });
      } catch (e) { throw Object.assign(e, { text }); } // wat al geschreven was, blijft zichtbaar
      // Eerst de stop_reason: na een weigering of een afgekapte beurt worden de tools niet uitgevoerd.
      if (res.stop_reason === "refusal") throw Object.assign(new AIError("refused"), { text });
      if (res.stop_reason !== "tool_use") return { text, truncated: res.stop_reason === "max_tokens" };
      const results = [];
      for (const b of res.content.filter(b => b.type === "tool_use")) {
        const tool = tools.find(t => t.name === b.name);
        let out, is_error = false;
        try {
          if (b.bad_input) throw new Error("The tool input was not valid JSON. Call the tool again.");
          if (!tool) throw new Error(`Unknown tool: ${b.name}`);
          out = await tool.run(b.input);
        } catch (e) { out = e?.message || String(e); is_error = true; }
        results.push({ type: "tool_result", tool_use_id: b.id, content: typeof out === "string" ? out : JSON.stringify(out ?? null), ...(is_error && { is_error }) });
        if (b.bad_input) { delete b.bad_input; b.input = {}; }
      }
      // Claude's beurt ongewijzigd terug (thinking-blokken met signature), dan alle toolresultaten in één bericht.
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: results });
      if (text) text += "\n\n";
    }
    return { text, truncated: true };
  }

  // Eén vraag, antwoord als JSON-object volgens schema (structured outputs).
  async function json(prompt, schema, { signal } = {}) {
    const msg = await send({
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    }, { signal });
    // Eerst de stop_reason: bij een weigering of een afgekapt antwoord klopt de JSON niet.
    if (msg?.stop_reason === "refusal") throw new AIError("refused");
    if (msg?.stop_reason === "max_tokens") throw new AIError("truncated");
    const text = (Array.isArray(msg?.content) ? msg.content : []).filter(b => b.type === "text").map(b => b.text).join("");
    try { return JSON.parse(text); } catch { throw new AIError("invalid_json"); }
  }

  return { send, json, stream, chat };
}
