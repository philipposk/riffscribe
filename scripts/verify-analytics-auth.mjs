#!/usr/bin/env node
/**
 * Checks what analytics do when the signed-in person changes (Providers.tsx).
 *
 * - Supabase's first event for a signed-out visitor (null -> null) must not
 *   reset PostHog: reset() wipes PostHog's stored opt-in, which switched
 *   capturing off on every page load for visitors who had accepted.
 * - A real sign-out resets the id and, with consent, switches capturing back on.
 * - An account switch resets before identifying the new person.
 * - A visitor who has not opted in is never reset or identified.
 * - PostHog is told not to store anything while opted out.
 *
 * Providers.tsx is JSX, so the function is cut out between its markers and
 * loaded with Node's type stripping.
 *
 * Run with: node --experimental-strip-types scripts/verify-analytics-auth.mjs
 */
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const src = readFileSync(new URL("../src/components/Providers.tsx", import.meta.url), "utf8");
const block = src.match(/\/\/ analyticsOnAuth:start[^\n]*\n([\s\S]*?)\/\/ analyticsOnAuth:end/)?.[1];
let analyticsOnAuth;
try {
  if (!block) throw new Error("analyticsOnAuth markers not found in Providers.tsx");
  const js = stripTypeScriptTypes(block);
  ({ analyticsOnAuth } = await import(`data:text/javascript,${encodeURIComponent(js)}`));
  if (typeof analyticsOnAuth !== "function") throw new Error("analyticsOnAuth is not exported");
} catch (e) {
  console.log(`could not load analyticsOnAuth: ${e?.message ?? e}`);
  process.exit(1);
}

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

/** A PostHog stand-in: reset() clears the stored opt-in, as posthog-js 1.433.5 does. */
function fake(optedIn) {
  const calls = [];
  return {
    calls,
    optedIn,
    has_opted_in_capturing() { return this.optedIn; },
    identify(id) { calls.push(`identify:${id}`); },
    reset() { calls.push("reset"); this.optedIn = false; },
    opt_in_capturing() { calls.push("opt_in"); this.optedIn = true; },
  };
}

{
  const ph = fake(true);
  const id = analyticsOnAuth(ph, null, null, true);
  check("signed-out page load leaves an accepted visitor opted in", ph.optedIn && ph.calls.length === 0, ph.calls.join(","));
  check("returns null for a signed-out visitor", id === null);
}
{
  const ph = fake(true);
  const id = analyticsOnAuth(ph, null, "u1", true);
  check("signed-in page load identifies without reset", ph.calls.join(",") === "identify:u1", ph.calls.join(","));
  check("returns the new id", id === "u1");
}
{
  const ph = fake(true);
  analyticsOnAuth(ph, "u1", null, true);
  check("sign-out with consent resets then opts back in", ph.calls.join(",") === "reset,opt_in" && ph.optedIn, ph.calls.join(","));
}
{
  const ph = fake(true);
  analyticsOnAuth(ph, "u1", null, false);
  check("sign-out without a stored consent stays opted out", ph.calls.join(",") === "reset" && !ph.optedIn, ph.calls.join(","));
}
{
  const ph = fake(true);
  analyticsOnAuth(ph, "u1", "u2", true);
  check("account switch resets, opts in, identifies the new person", ph.calls.join(",") === "reset,opt_in,identify:u2", ph.calls.join(","));
}
{
  const ph = fake(true);
  analyticsOnAuth(ph, "u1", "u1", true);
  check("same person again (token refresh) does not reset", ph.calls.join(",") === "identify:u1", ph.calls.join(","));
}
{
  const ph = fake(false);
  analyticsOnAuth(ph, null, null, false);
  analyticsOnAuth(ph, null, "u1", false);
  analyticsOnAuth(ph, "u1", null, false);
  analyticsOnAuth(ph, "u1", "u2", false);
  check("a visitor who has not opted in is never reset or identified", ph.calls.length === 0, ph.calls.join(","));
}

check(
  "PostHog stores nothing while opted out (opt_out_persistence_by_default)",
  /opt_out_persistence_by_default:\s*true/.test(src),
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall analytics auth checks passed");
process.exit(failed ? 1 : 0);
