#!/usr/bin/env node
/**
 * Checks that the monoline eval stage gates the clean-up the app ships (cleanMonoLine with no
 * contour, Studio.tsx), not the contour comparison, and that every gate holds on the recorded
 * baseline. No model.
 *
 * Run with: node --experimental-strip-types scripts/verify-monoline-gates.mjs
 */
import { readFileSync } from "node:fs";

const load = (p) => import(p).catch((e) => { console.log(e.message); return null; });
const stage = await load("./eval-cello/stages/monoline.mjs");
if (!stage) {
  console.log("run with: node --experimental-strip-types scripts/verify-monoline-gates.mjs");
  process.exit(1);
}
const { SHIPPED, GATES, cleanups } = stage;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail !== undefined ? `: ${detail}` : ""}`);
};

// 1. the shipped variant calls cleanMonoLine once, with no contour, and never tracks the curve
{
  const calls = [];
  let tracked = 0;
  const clean = (notes, opts) => { calls.push(opts ?? {}); return notes; };
  const variants = cleanups(clean, () => [], () => { tracked++; return {}; });
  check("shipped suffix is a variant", typeof variants[SHIPPED] === "function", SHIPPED);
  variants[SHIPPED]([], { contours: [] }, 1);
  check("shipped variant cleans once", calls.length === 1, calls.length);
  check("shipped variant passes no contour", calls.every((o) => o.contour == null), JSON.stringify(calls));
  check("shipped variant does not track the curve", tracked === 0, tracked);
}

// 2. the contour variant really is the contour path (so it is the comparison, not the shipped one)
{
  const calls = [];
  const clean = (notes, opts) => { calls.push(opts ?? {}); return notes; };
  cleanups(clean, () => [], () => ({ marker: true }))[""]([], { contours: [] }, 1);
  check("unsuffixed variant cleans with a contour", calls.some((o) => o.contour?.marker), JSON.stringify(calls));
}

// 3. every gate sits on a shipped key, and the five expected gates are all there
{
  check("all gates on shipped keys", GATES.every((g) => g.key.endsWith(SHIPPED)), GATES.map((g) => g.key).join(", "));
  const want = ["fragmentation_vib40", "fragmentation_vib80", "offPitch_vib40", "offPitch_vib80", "f1_vib1"];
  check("expected gates present", want.every((k) => GATES.some((g) => g.key === k + SHIPPED)));
}

// 4. the recorded baseline has every gated key and passes every gate
{
  const base = JSON.parse(readFileSync(new URL("./eval-cello/baselines/monoline.json", import.meta.url), "utf8")).metrics;
  const ops = { "<=": (a, b) => a <= b, ">=": (a, b) => a >= b, "==": (a, b) => a === b };
  for (const g of GATES) {
    const v = base[g.key];
    check(`baseline ${g.key} ${g.op} ${g.value}`, Number.isFinite(v) && ops[g.op](v, g.value), v);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall monoline gate checks passed");
process.exit(failed ? 1 : 0);
