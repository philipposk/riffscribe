#!/usr/bin/env node
/**
 * Checks a take recorded over a repeating loop is folded back onto the loop, not laid
 * out in a straight line over the bars after it.
 *
 * Run with: node --experimental-strip-types scripts/verify-recorder.mjs
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const mod = await import("../src/lib/audio/recorder.ts").catch(() => null);
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-recorder.mjs");
  process.exit(0);
}
const { foldLoopTake, placeTake } = mod;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const SR = 100;
/** A take made of segments, each filled with its own value so we can tell which was kept. */
function take(startSeconds, segments) {
  const n = segments.reduce((s, [secs]) => s + Math.round(secs * SR), 0);
  const left = new Float32Array(n);
  let i = 0;
  for (const [secs, v] of segments) for (let k = 0; k < Math.round(secs * SR); k++) left[i++] = v;
  return { left, right: Float32Array.from(left), startSeconds, sampleRate: SR };
}
const loop = [2, 4];

{
  // started mid-loop at 3 s: 1 s to the loop end, two full passes, then half a pass
  const t = take(3, [[1, 9], [2, 1], [2, 2], [0.5, 3]]);
  const f = foldLoopTake(t, loop);
  check("keeps the last complete pass", f.left.length === 2 * SR && f.left.every((v) => v === 2), `${f.left.length} samples, first ${f.left[0]}`);
  check("puts it at the loop start", f.startSeconds === 2);
  const [pl] = placeTake(f, 10 * SR);
  let outside = 0;
  for (let i = 0; i < pl.length; i++) if (pl[i] !== 0 && (i < 2 * SR || i >= 4 * SR)) outside++;
  check("nothing lands outside the loop", outside === 0, `${outside} samples outside`);
}

{
  // started before the loop: the lead-in pass counts as complete
  const t = take(1, [[3, 7], [1, 8]]);
  const f = foldLoopTake(t, loop);
  check("a lead-in pass that covers the whole loop is kept", f.startSeconds === 1 && f.left.length === 3 * SR && f.left[0] === 7);
}

{
  // started mid-loop, stopped just after it wrapped: no complete pass, keep the longest
  const t = take(3, [[1, 5], [0.4, 6]]);
  const f = foldLoopTake(t, loop);
  check("with no complete pass the longest is kept, where it was played", f.startSeconds === 3 && f.left.length === SR && f.left[0] === 5);
}

{
  const t = take(2.5, [[1, 4]]);
  check("a take that never wrapped is left alone", foldLoopTake(t, loop) === t);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall recorder checks passed");
