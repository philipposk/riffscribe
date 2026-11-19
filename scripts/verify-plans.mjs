#!/usr/bin/env node
/**
 * Checks the plan limits shown in the app (src/lib/plans.ts) are the ones the
 * database enforces (riffscribe_limits in supabase/accounts.sql, or the last
 * migration that redefines it).
 *
 * Run with: node --experimental-strip-types scripts/verify-plans.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const mod = await import("../src/lib/plans.ts").catch((e) => {
  console.log(e);
  return null;
});
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-plans.mjs");
  process.exit(1);
}
const { PLANS } = mod;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

// The definition lives in accounts.sql; a later migration may replace it.
const files = ["supabase/accounts.sql"];
if (existsSync("supabase/migrations")) {
  for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()) {
    files.push(`supabase/migrations/${f}`);
  }
}
const DEF = /create\s+(?:or\s+replace\s+)?function\s+public\.riffscribe_limits\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/i;
let body = null;
let source = null;
for (const f of files) {
  const m = DEF.exec(readFileSync(f, "utf8"));
  if (m) {
    body = m[1];
    source = f;
  }
}
check("riffscribe_limits is defined in the SQL", body !== null);

const CASE = /case\s+when\s+plan\s*=\s*'free'\s+then\s+(\d+)\s+else\s+(\d+)\s+end/gi;
const cases = [...(body ?? "").matchAll(CASE)].map((m) => [Number(m[1]), Number(m[2])]);
check("it holds two free/else cases (songs, assistant)", cases.length === 2, `${cases.length} in ${source}`);

if (cases.length === 2) {
  const [songs, assistant] = cases;
  check("free songs match", songs[0] === PLANS.free.songs, `${songs[0]} vs ${PLANS.free.songs}`);
  check("pro songs match", songs[1] === PLANS.pro.songs, `${songs[1]} vs ${PLANS.pro.songs}`);
  check("free assistant matches", assistant[0] === PLANS.free.assistant, `${assistant[0]} vs ${PLANS.free.assistant}`);
  check("pro assistant matches", assistant[1] === PLANS.pro.assistant, `${assistant[1]} vs ${PLANS.pro.assistant}`);
}

process.exit(failed ? 1 : 0);
