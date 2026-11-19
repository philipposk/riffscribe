#!/usr/bin/env node
/**
 * Checks the resumable AI split stitches blocks as they arrive exactly as the original
 * all-at-once stitch did (overlap ramps and a resumed block included), and that its
 * progress never runs past the block it is on. The Demucs worker is faked.
 *
 * Run with: node --experimental-strip-types scripts/verify-stems.mjs
 */
const mod = await import("../src/lib/audio/stems.ts").catch(() => null);
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-stems.mjs");
  process.exit(1);
}
const { separateResumable } = mod;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const NAMES = ["vocals", "drums", "bass", "other"];
/** What the fake model "separates": a different, position-dependent shape per stem. */
const fakeStems = (l, r) => Object.fromEntries(NAMES.map((n, k) => [n, {
  left: Float32Array.from(l, (v, i) => v * (k + 1) + Math.sin(i * 0.001 * (k + 1))),
  right: Float32Array.from(r, (v, i) => v * (k + 2) - Math.cos(i * 0.002 * (k + 1))),
}]));

const blocksRun = [];
globalThis.Worker = class {
  postMessage(msg) {
    const stems = fakeStems(msg.left, msg.right);
    blocksRun.push(msg.left.length);
    setTimeout(() => {
      // demucs-web counts one window fewer than it runs, so it reports past 1
      this.onmessage?.({ data: { type: "progress", progress: 1.2, segment: 6, segments: 5 } });
      this.onmessage?.({ data: { type: "done", stems } });
    }, 0);
  }
  terminate() {}
};

// ~3.3 blocks of demucs-web windows
const TOTAL = 4_200_000;
const left = new Float32Array(TOTAL), right = new Float32Array(TOTAL);
for (let i = 0; i < TOTAL; i++) { left[i] = Math.sin(i * 0.01); right[i] = Math.cos(i * 0.013); }

// Block 1 was finished in an earlier session.
const saved = new Map();
const store = {
  done: async () => new Set(saved.keys()),
  get: async (_k, b) => saved.get(b) ?? null,
  put: async (_k, b, res) => { saved.set(b, res); },
  clear: async () => { saved.clear(); },
};

/** The original stitch: every block's result held, then summed. */
function oldStitch(plan, results, total) {
  const out = Object.fromEntries(NAMES.map((n) => [n, { left: new Float32Array(total), right: new Float32Array(total) }]));
  const weight = new Float32Array(total);
  plan.forEach(({ start, end }, b) => {
    const fadeIn = b > 0 ? plan[b - 1].end - start : 0;
    const fadeOut = b < plan.length - 1 ? end - plan[b + 1].start : 0;
    for (let i = 0; i < end - start; i++) {
      let w = 1;
      if (fadeIn > 0 && i < fadeIn) w = Math.min(w, (i + 0.5) / fadeIn);
      if (fadeOut > 0 && i >= end - start - fadeOut) w = Math.min(w, (end - start - i - 0.5) / fadeOut);
      weight[start + i] += w;
      for (const n of NAMES) {
        out[n].left[start + i] += results[b][n].left[i] * w;
        out[n].right[start + i] += results[b][n].right[i] * w;
      }
    }
  });
  for (let i = 0; i < total; i++) {
    const w = weight[i] || 1;
    if (w !== 1) for (const n of NAMES) { out[n].left[i] /= w; out[n].right[i] /= w; }
  }
  return out;
}

// Same block layout as stems.ts.
const T = 343980, S = Math.floor(T * 0.75), BS = 5;
const segments = Math.max(1, Math.ceil(Math.max(0, TOTAL - T) / S) + 1);
const plan = Array.from({ length: Math.ceil(segments / BS) }, (_, b) => {
  const first = b * BS;
  const count = Math.min(BS, segments - first);
  const start = first * S;
  return { start, end: Math.min(TOTAL, start + (count - 1) * S + T) };
});
check("the test song spans several blocks", plan.length >= 3, `${plan.length} blocks`);
saved.set(1, fakeStems(left.slice(plan[1].start, plan[1].end), right.slice(plan[1].start, plan[1].end)));
const results = plan.map(({ start, end }) => fakeStems(left.slice(start, end), right.slice(start, end)));

const progress = [];
const { promise } = separateResumable("song:1", left, right, store, (p) => {
  if (p.phase === "separate") progress.push(p.value);
});
const got = await promise;
const want = oldStitch(plan, results, TOTAL);

let worst = 0;
for (const n of NAMES) for (const side of ["left", "right"]) {
  const a = got[n][side], b = want[n][side];
  if (a.length !== b.length) worst = Infinity;
  else for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
}
check("incremental stitch matches the all-at-once stitch", worst === 0, `max difference ${worst}`);
check("the saved block was reused, not run again", blocksRun.length === plan.length - 1, `${blocksRun.length} blocks run`);
check("saved blocks are cleared once the split is done", saved.size === 0);
const overshoot = progress.some((v, i) => v > 1 || (i > 0 && v < progress[i - 1]));
check("progress never overshoots or runs backwards", !overshoot, progress.map((v) => v.toFixed(2)).join(" "));

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall stem checks passed");
