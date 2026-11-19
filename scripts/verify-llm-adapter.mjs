#!/usr/bin/env node
/**
 * Checks the model adapter without a key and without the internet.
 *
 * - The capped round converts to valid Messages API input: tool results merged
 *   and paired with their calls, leading assistant turns dropped, a forced
 *   tool turned into a sentence only when that tool exists, no thinking
 *   blocks, no sampling settings.
 * - Settings: only allowlisted models and known efforts survive; the default
 *   is Claude Haiku 5.5; the fallback chain follows the keys that are set.
 * - callAnthropic against a local stand-in for the API (ANTHROPIC_BASE_URL):
 *   the request it sends, and which failures hand over to the fallback.
 * - No route reads a model or provider from the request body.
 *
 * Run with: node --experimental-strip-types scripts/verify-llm-adapter.mjs
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const models = await import("../src/lib/llm/models.ts").catch((e) => (console.error(e), null));
const adapter = await import("../src/lib/llm/anthropic.ts").catch((e) => (console.error(e), null));
const openrouter = await import("../src/lib/llm/openrouter.ts").catch((e) => (console.error(e), null));
if (!models || !adapter || !openrouter) {
  console.log("run with: node --experimental-strip-types scripts/verify-llm-adapter.mjs");
  process.exit(1);
}
const { MODELS, TASKS, parseLlmSettings, validateLlmSettings, defaultLlmSettings, modelChain, estimateCost } = models;
const { toAnthropic, readContent, callAnthropic, LlmUnavailable } = adapter;
const { openRouterBody } = openrouter;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

const tools = [
  { type: "function", function: { name: "describe_studio", description: "Report what is loaded.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "split_stems", description: "Separate the song.", parameters: { type: "object", properties: { mode: { type: "string" } } } } },
];
const call = (id, name, args = {}) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

/* -------------------------------------------------------- message conversion */
const round = {
  model: "ignored",
  temperature: 0.2,
  max_tokens: 700,
  tools,
  tool_choice: "auto",
  messages: [
    { role: "system", content: "You are the studio hand." },
    { role: "user", content: "what is loaded, and split it" },
    { role: "assistant", content: "Checking.", tool_calls: [call("c1", "describe_studio"), call("c2", "split_stems", { mode: "ai" })] },
    { role: "tool", tool_call_id: "c1", content: "A song is loaded." },
    { role: "tool", tool_call_id: "c2", content: "Split finished." },
  ],
};
const a = toAnthropic(round);
check("system messages become the system prompt", a.system === "You are the studio hand." && a.messages.every((m) => m.role !== "system"));
check("conversation alternates user / assistant / user", a.messages.map((m) => m.role).join() === "user,assistant,user", a.messages.map((m) => m.role).join());
const results = a.messages[2].content;
check("two consecutive tool results merge into one user message", results.length === 2 && results.every((b) => b.type === "tool_result"));
check("each result keeps its tool_use_id", results[0].tool_use_id === "c1" && results[1].tool_use_id === "c2");
const asst = a.messages[1].content;
check("an assistant turn with calls is its text plus tool_use blocks", asst[0].type === "text" && asst[1].type === "tool_use" && asst[2].type === "tool_use");
check("tool_use input is the parsed arguments", JSON.stringify(asst[2].input) === '{"mode":"ai"}');
check("tools are { name, description, input_schema }", a.tools.length === 2 && a.tools.every((t) => t.name && "input_schema" in t && t.input_schema.type === "object" && !("function" in t)));
check("auto tool choice adds no hint", a.forceTool === null && !JSON.stringify(a.messages).includes("tool now."));

const leading = toAnthropic({
  messages: [
    { role: "system", content: "s" },
    { role: "assistant", content: "Hi! Ask me anything." },
    { role: "user", content: "hello" },
  ],
});
check("a leading assistant message is dropped", leading.messages.length === 1 && leading.messages[0].role === "user");

const orphaned = toAnthropic({
  messages: [
    { role: "assistant", content: "", tool_calls: [call("x1", "describe_studio")] },
    { role: "tool", tool_call_id: "x1", content: "loaded" },
    { role: "user", content: "and now?" },
  ],
});
check("results of a dropped leading call go with it", orphaned.messages.length === 1 && orphaned.messages[0].content.every((b) => b.type === "text"));

const stray = toAnthropic({
  tools,
  messages: [
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [call("k1", "describe_studio"), call("k2", "split_stems")] },
    { role: "tool", tool_call_id: "k1", content: "ok" },
    { role: "tool", tool_call_id: "zz", content: "from nowhere" },
  ],
});
const strayResults = stray.messages[2].content.filter((b) => b.type === "tool_result");
check("a result with no matching call is dropped", !strayResults.some((b) => b.tool_use_id === "zz"));
check("a call with no result gets an error result", strayResults.some((b) => b.tool_use_id === "k2" && b.is_error === true));

const trailing = toAnthropic({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
check("the conversation never ends on an assistant turn (no prefill)", trailing.messages[trailing.messages.length - 1].role === "user");
const emptyText = toAnthropic({ tools, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "  ", tool_calls: [call("e1", "describe_studio")] }, { role: "tool", tool_call_id: "e1", content: "" }] });
check("empty text blocks are dropped", !JSON.stringify(emptyText.messages).includes('"text":"  "') && emptyText.messages[1].content.every((b) => b.type !== "text"));

const noTools = toAnthropic({ messages: [
  { role: "user", content: "go" },
  { role: "assistant", content: "", tool_calls: [call("n1", "describe_studio")] },
  { role: "tool", tool_call_id: "n1", content: "loaded" },
] });
check("with no tools declared, history tool blocks become text", !JSON.stringify(noTools.messages).includes("tool_use") && !JSON.stringify(noTools.messages).includes("tool_result"));

const forced = toAnthropic({ ...round, tool_choice: { type: "function", function: { name: "split_stems" } } });
const lastBlocks = forced.messages[forced.messages.length - 1].content;
check("forcing a declared tool appends the hint to the last user message", forced.forceTool === "split_stems" && lastBlocks[lastBlocks.length - 1].text === "Use the split_stems tool now.");
const notDeclared = toAnthropic({ ...round, tool_choice: { type: "function", function: { name: "delete_everything" } } });
check("forcing an undeclared tool adds nothing", notDeclared.forceTool === null && !JSON.stringify(notDeclared.messages).includes("tool now."));

const everything = JSON.stringify([a, leading, orphaned, stray, trailing, forced]);
check("no conversion output contains temperature", !everything.includes("temperature"));
check("no conversion output contains a thinking block or tool_choice", !everything.includes('"thinking"') && !everything.includes("tool_choice"));
const read = readContent([{ type: "thinking", thinking: "" }, { type: "text", text: "Done." }, { type: "tool_use", id: "t", name: "split_stems", input: { mode: "ai" } }]);
check("responses keep text and tool calls, never thinking", read.text === "Done." && read.toolCalls.length === 1 && read.toolCalls[0].args.mode === "ai");

const orBody = openRouterBody("openai/gpt-oss-20b", round);
check("the OpenRouter body has no temperature", !JSON.stringify(orBody).includes("temperature"));
check("the OpenRouter body denies data collection", orBody.provider?.data_collection === "deny");
check("the OpenRouter model is the server's, not the request's", orBody.model === "openai/gpt-oss-20b");

/* ------------------------------------------------------------------ settings */
const def = defaultLlmSettings();
check("the default is Claude Haiku 5.5", TASKS.assistant.default === "anthropic/claude-haiku-5-5" && def.assistant.model === "anthropic/claude-haiku-5-5");
check("the default effort is low and the assistant is on", def.assistant.effort === "low" && def.assistant.enabled === true);
check("an off-list model becomes the default", parseLlmSettings({ assistant: { model: "anthropic/claude-fable-5-2" } }).assistant.model === "anthropic/claude-haiku-5-5");
check("a bare id is not a key", parseLlmSettings({ assistant: { model: "claude-fable-5-2" } }).assistant.model === "anthropic/claude-haiku-5-5");
check("garbage becomes the defaults", [null, "x", 42, [], { assistant: "x" }].every((g) => JSON.stringify(parseLlmSettings(g)) === JSON.stringify(def)));
const bad = parseLlmSettings({ assistant: { model: "anthropic/claude-opus-5-5", effort: "max", enabled: "yes" } });
check("an allowed model is kept; bad effort and enabled reset", bad.assistant.model === "anthropic/claude-opus-5-5" && bad.assistant.effort === "low" && bad.assistant.enabled === true);
check("a valid submission is accepted", validateLlmSettings({ assistant: { model: "anthropic/claude-sonnet-5-5", effort: "medium", enabled: false } }).ok);
check("a submission parsing would change is rejected", ![
  { assistant: { model: "anthropic/claude-fable-5-2", effort: "low", enabled: true } },
  { assistant: { model: "anthropic/claude-haiku-5-5", effort: "max", enabled: true } },
  { assistant: { model: "anthropic/claude-haiku-5-5", effort: "low", enabled: 1 } },
  { assistant: { model: "anthropic/claude-haiku-5-5", effort: "low", enabled: true, x: 1 } },
  { assistant: { model: "anthropic/claude-haiku-5-5", effort: "low", enabled: true }, other: {} },
  {},
].some((s) => validateLlmSettings(s).ok));
check("every allowed model is in the price table", Object.values(TASKS).every((t) => t.allowed.every((k) => k in MODELS)));

const chain = (chosen, anthropic, openrouter) => modelChain("assistant", chosen, { anthropic, openrouter }).join(",");
check("Claude first, then the OpenRouter fallback", chain("anthropic/claude-haiku-5-5", true, true) === "anthropic/claude-haiku-5-5,openrouter/openai/gpt-oss-20b");
check("no Anthropic key goes straight to OpenRouter", chain("anthropic/claude-opus-5-5", false, true) === "openrouter/openai/gpt-oss-20b");
check("no OpenRouter key leaves Claude alone", chain("anthropic/claude-sonnet-5-5", true, false) === "anthropic/claude-sonnet-5-5");
check("the open model with only an Anthropic key uses the default", chain("openrouter/openai/gpt-oss-20b", true, false) === "anthropic/claude-haiku-5-5");
check("no keys, no chain", chain("anthropic/claude-haiku-5-5", false, false) === "");
check("cost: 1M Haiku input tokens is $0.10", estimateCost("anthropic/claude-haiku-5-5", 1_000_000, 0, 0) === 0.1);
check("cost: cache reads at a tenth, output at its own price", estimateCost("anthropic/claude-opus-5-5", 0, 1_000_000, 1_000_000) === 20.4);
check("cost: unknown prices are null, not zero", estimateCost("openrouter/openai/gpt-oss-20b", 1000, 0, 1000) === null && estimateCost("nope", 1, 1, 1) === null);

/* --------------------------------------------- callAnthropic, local stand-in */
let reply = { status: 200, body: {} };
const seen = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.writeHead(reply.status, { "content-type": "application/json", "x-should-retry": "false" });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ANTHROPIC_API_KEY = "test-key-not-real";

const message = (content, stop = "end_turn") => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 40 },
});
const apiError = (type, msg) => ({ type: "error", error: { type, message: msg } });
async function outcome(model = "claude-haiku-5-5") {
  try {
    return { ok: await callAnthropic({ model, effort: "low", maxOutput: 2048, request: round }) };
  } catch (e) {
    return { err: e };
  }
}

reply = { status: 200, body: message([{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Splitting." }, { type: "tool_use", id: "tu1", name: "split_stems", input: { mode: "ai" } }], "tool_use") };
const good = await outcome();
check("a normal answer comes back as text and tool calls", good.ok?.text === "Splitting." && good.ok?.toolCalls[0]?.name === "split_stems", good.err?.message);
check("usage counts cache writes as input and cache reads as cached", good.ok?.usage.input === 120 && good.ok?.usage.cached === 300 && good.ok?.usage.output === 40);
const sent = seen[seen.length - 1]?.body ?? {};
check("the request uses the bare model id and the task's ceiling", sent.model === "claude-haiku-5-5" && sent.max_tokens === 2048);
check("effort goes in output_config", sent.output_config?.effort === "low");
check("the system prompt is cached", sent.system?.[0]?.cache_control?.type === "ephemeral");
check("no temperature, thinking or tool_choice is sent", !("temperature" in sent) && !("thinking" in sent) && !("tool_choice" in sent));
check("Haiku goes to the plain endpoint", seen[seen.length - 1]?.url?.startsWith("/v1/messages") && !seen[seen.length - 1]?.url?.includes("beta=true") && !("fallbacks" in sent));

reply = { status: 200, body: message([{ type: "text", text: "ok" }]) };
await outcome("claude-sonnet-5-5");
const beta = seen[seen.length - 1];
check("Sonnet 5.5 asks for the server-side fallback", beta?.body?.fallbacks === "default" && String(beta?.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01"));

const isUnavailable = (r) => r.err instanceof LlmUnavailable;
reply = { status: 429, body: apiError("rate_limit_error", "slow down") };
check("a rate limit hands over to the fallback", isUnavailable(await outcome()));
reply = { status: 529, body: apiError("overloaded_error", "overloaded") };
check("an overloaded API hands over", isUnavailable(await outcome()));
reply = { status: 500, body: apiError("api_error", "boom") };
check("a 5xx hands over", isUnavailable(await outcome()));
reply = { status: 400, body: apiError("invalid_request_error", "tools.3.custom.input_schema: JSON schema is invalid") };
check("a rejected tool schema hands over", isUnavailable(await outcome()));
reply = { status: 400, body: apiError("invalid_request_error", "messages: roles must alternate") };
const other400 = await outcome();
check("any other 400 is final, not a fallback", other400.err && !isUnavailable(other400));
reply = { status: 401, body: apiError("authentication_error", "invalid x-api-key") };
const auth = await outcome();
check("a bad key is final, not a fallback", auth.err && !isUnavailable(auth));
reply = { status: 200, body: message([], "refusal") };
check("a refusal hands over", isUnavailable(await outcome()));
server.close();

/* ------------------------------------------------------------------- sources */
function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const api = files("src/app/api").map((p) => [p, readFileSync(p, "utf8")]);
const llm = files("src/lib/llm").map((p) => [p, readFileSync(p, "utf8")]);
const hits = (list, re) => list.filter(([, s]) => re.test(s)).map(([p]) => p);
check("no route reads a model or provider from the body", !hits(api, /body\.(model|provider)/).length, hits(api, /body\.(model|provider)/).join());
check("no temperature or ASSISTANT_MODEL in the routes or lib/llm", !hits([...api, ...llm], /temperature|ASSISTANT_MODEL/).length, hits([...api, ...llm], /temperature|ASSISTANT_MODEL/).join());
const anthropicSrc = readFileSync("src/lib/llm/anthropic.ts", "utf8");
check("Anthropic is called through the SDK, not fetch", anthropicSrc.includes('from "@anthropic-ai/sdk"') && !/\bfetch\(/.test(anthropicSrc));
const route = readFileSync("src/app/api/pa/v1/llm/complete/route.ts", "utf8");
check("the assistant route goes through complete()", route.includes('complete("assistant"'));
check("the body is size-checked before it is parsed", route.indexOf("MAX_BODY_BYTES") > 0 && route.indexOf("Buffer.byteLength(raw") < route.indexOf("buildCompletion(raw"));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
