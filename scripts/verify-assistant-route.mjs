#!/usr/bin/env node
/**
 * Checks the assistant's server route without a server or a database.
 *
 * - Every part of a round is capped before it reaches the model: tool schemas,
 *   tool-call arguments, names and ids, not only message text.
 * - A round is charged only after its body is valid, refunded when the model
 *   gives no answer, and a used-up month reads as an answer, not "busy".
 * - Deleting your data keeps this month's counter, so it cannot reset the allowance,
 *   and the refund cannot be called from a browser.
 * - The mic never falls back to a speech-to-text route Riffscribe does not have.
 *
 * Run with: node --experimental-strip-types scripts/verify-assistant-route.mjs
 */
import { existsSync, readFileSync } from "node:fs";

const mod = await import("../src/lib/assistantRequest.ts").catch(() => null);
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-assistant-route.mjs");
  process.exit(1);
}
const { buildCompletion, LIMITS, QUOTA_USED_UP_TEXT, usagePeriod } = mod;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}
const build = (body) => buildCompletion(JSON.stringify(body), "test/model");

/* ---------------------------------------------------------- a normal round */
const realTools = [
  { name: "describe_studio", description: "Report what is loaded.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "split_stems",
    description: "Separate the song. (requires user confirmation)",
    parameters: { type: "object", properties: { mode: { type: "string", enum: ["instant", "ai"] } }, required: ["mode"], additionalProperties: false },
  },
];
const normal = build({
  system: "You are the studio hand.",
  messages: [
    { role: "user", content: "split it" },
    { role: "assistant", content: "", toolCalls: [{ id: "tc_abc_1", name: "split_stems", args: { mode: "ai" } }] },
    { role: "tool", toolName: "split_stems", toolCallId: "tc_abc_1", content: "The AI split finished." },
  ],
  tools: realTools,
  forceTool: "split_stems",
  temperature: 0,
});
check("a normal round is accepted", normal.ok);
const np = normal.payload;
check("real tool schemas pass through unchanged", JSON.stringify(np.tools.map((t) => t.function.parameters)) === JSON.stringify(realTools.map((t) => t.parameters)));
check("real tool-call args pass through", np.messages[2].tool_calls[0].function.arguments === '{"mode":"ai"}');
check("tool result stays paired with its call", np.messages[3].tool_call_id === np.messages[2].tool_calls[0].id);
check("forcing a real tool is kept", np.tool_choice?.function?.name === "split_stems");
check("model is fixed by the server", np.model === "test/model");

/* ------------------------------------------------------------ bad requests */
check("invalid JSON is a 400", buildCompletion("{nope", "m").status === 400);
check("a body over the size cap is a 413 before parsing", buildCompletion("x".repeat(LIMITS.maxBodyChars + 1), "m").status === 413);

/* ------------------------------------------------------ the finding's attack */
const blob = (n) => ({ type: "object", properties: { x: { type: "string", description: "a".repeat(n) } } });
const attack = {
  system: "s",
  tools: Array.from({ length: 40 }, (_, i) => ({ name: `tool_${i}`, description: "d".repeat(5000), parameters: blob(10_000) })),
  messages: Array.from({ length: 24 }, () => ({
    role: "assistant",
    content: "",
    toolCalls: Array.from({ length: 40 }, (_, j) => ({ id: "i".repeat(500) + j, name: "n".repeat(500), args: { a: "b".repeat(5000) } })),
  })),
};
const raw = JSON.stringify(attack);
// The attack is far bigger than the body cap, which already stops it; shrink it under the cap to test the rest.
check("the oversized attack is refused outright", buildCompletion(raw, "m").status === 413, `${raw.length} chars`);
const smaller = {
  ...attack,
  tools: attack.tools.map((t) => ({ ...t, description: "d".repeat(600), parameters: blob(2500) })),
  messages: attack.messages.slice(0, 1).map((m) => ({ ...m, toolCalls: m.toolCalls.slice(0, 20).map((c) => ({ ...c, args: { a: "b".repeat(2500) } })) })),
};
const sr = JSON.stringify(smaller);
check("the shrunk attack fits under the body cap", sr.length <= LIMITS.maxBodyChars, `${sr.length} chars`);
const s = buildCompletion(sr, "m");
if (s.ok) {
  const p = s.payload;
  const size = JSON.stringify(p).length;
  check("total payload stays under the cap", size <= LIMITS.maxPayloadChars, `${size} chars`);
  check("oversized tool schemas are replaced", p.tools.every((t) => JSON.stringify(t.function.parameters).length <= LIMITS.maxSchemaChars));
  const toolChars = JSON.stringify(p.tools).length;
  check("all tools together stay bounded", toolChars <= LIMITS.maxToolChars + p.tools.length * 80, `${toolChars} chars`);
  const calls = p.messages.flatMap((m) => m.tool_calls ?? []);
  check("oversized tool-call args are dropped", calls.every((c) => c.function.arguments.length <= LIMITS.maxArgsChars));
  check("names and ids are clipped to 64", calls.every((c) => c.id.length <= 64 && c.function.name.length <= 64));
} else {
  check("the shrunk attack is either capped or refused", s.status === 413);
}

/* ------------------------------------------------------------- names */
const named = build({
  messages: [
    { role: "assistant", content: "", toolCalls: [{ id: "x".repeat(200), name: "functions.split stems", args: {} }] },
    { role: "tool", toolCallId: "x".repeat(200), content: "ERROR: no such capability" },
  ],
  tools: [
    { name: "ok_name", description: "fine", parameters: { type: "object", properties: {} } },
    { name: "bad name!", description: "dropped", parameters: { type: "object", properties: {} } },
    { name: "y".repeat(65), description: "dropped", parameters: { type: "object", properties: {} } },
  ],
  forceTool: "bad name!",
});
check("tools with names providers reject are dropped", named.ok && named.payload.tools.map((t) => t.function.name).join() === "ok_name");
check("forcing a dropped tool falls back to auto", named.payload.tool_choice === "auto");
const call = named.payload.messages[1].tool_calls[0];
check("a history call name is made safe", /^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name), call.function.name);
check("a long id is clipped the same on both sides", call.id.length === 64 && named.payload.messages[2].tool_call_id === call.id);
check("non-object args become {}", build({ messages: [{ role: "assistant", content: "", toolCalls: [{ id: "a", name: "b", args: "x".repeat(10) }] }] }).payload.messages[1].tool_calls[0].function.arguments === "{}");

/* ------------------------------------------------------------- the route */
const route = readFileSync(new URL("../src/app/api/pa/v1/llm/complete/route.ts", import.meta.url), "utf8");
const at = (needle) => route.indexOf(needle);
check("the route uses the capped builder", at("buildCompletion(") > 0);
check("the body is checked before a request is charged", at("buildCompletion(") > 0 && at("buildCompletion(") < at('rpc("riffscribe_use_assistant")'));
check("a large Content-Length is refused before reading the body", at("content-length") > 0 && at("content-length") < at("req.text()"));
const quotaBlock = route.slice(at("if (!allowed)"), at("if (!allowed)") + 400);
check("a used-up month answers as a reply, not a 429", quotaBlock.includes("QUOTA_USED_UP_TEXT") && !quotaBlock.includes("429"));
check("the reply has the shape the widget reads", quotaBlock.includes("toolCalls: []") && quotaBlock.includes("text:"));
check("the reply text has no figures the grounding check would strip", !/\d/.test(QUOTA_USED_UP_TEXT.replace(/\(\/pricing\)/, "")));
const refunds = route.split("refund(").length - 1;
check("an unreachable or failed model refunds the request", refunds >= 3, `${refunds} refund calls`);
check("the refund goes through the service role only", route.includes("serviceClient()") && route.includes("riffscribe_refund_assistant"));
check("usagePeriod matches riffscribe_period()", /^\d{4}-\d{2}$/.test(usagePeriod()) && usagePeriod(new Date("2026-01-31T23:59:59Z")) === "2026-01");

/* ------------------------------------------------------------- SQL */
const sqlPath = new URL("../supabase/migrations/0003_review_fixes.sql", import.meta.url);
check("supabase/migrations/0003_review_fixes.sql exists", existsSync(sqlPath));
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, "utf8") : "";
const del = sql.slice(sql.indexOf("function public.riffscribe_delete_my_data"), sql.indexOf("end $$", sql.indexOf("function public.riffscribe_delete_my_data")));
check("deleting your data keeps this month's counter", /delete from public\.riffscribe_usage\s+where user_id = uid and period <> public\.riffscribe_period\(\)/.test(del));
check("deleting still removes songs, chats and the subscription", ["riffscribe_charts", "riffscribe_assistant_chats", "subscriptions"].every((t) => del.includes(t)));
check("the refund is revoked from browsers", /revoke all on function public\.riffscribe_refund_assistant\(uuid, text\) from public, anon, authenticated/.test(sql));
check("the refund is granted to the service role", /grant execute on function public\.riffscribe_refund_assistant\(uuid, text\) to service_role/.test(sql));
check("the refund never goes below zero", /assistant > 0/.test(sql));
check("every new SQL object is prefixed riffscribe_", [...sql.matchAll(/function public\.(\w+)/g)].every((m) => m[1].startsWith("riffscribe_")));

/* ------------------------------------------------------------- voice */
const assistant = readFileSync(new URL("../src/components/Assistant.tsx", import.meta.url), "utf8");
const widget = readFileSync(new URL("../vendor/page-assistant/widget/dist/index.js", import.meta.url), "utf8");
check("the mic is given no speech-to-text server", /voice:\s*\{\s*serverUrl:\s*undefined\s*\}/.test(assistant));
check("the widget lets voice options override serverUrl", widget.includes("vo = { serverUrl: cfg.serverUrl, ...cfg.voice };"));
check("there is still no STT route, so the override is still needed", !existsSync(new URL("../src/app/api/pa/v1/voice", import.meta.url)));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
