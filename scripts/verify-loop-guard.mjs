#!/usr/bin/env node
/**
 * Checks that setting a loop at the playhead never makes one too short to play
 * (end at 0:00, start at the very end, or just past an existing start/end).
 *
 * Run with: node --experimental-strip-types scripts/verify-loop-guard.mjs
 */
import assert from "node:assert/strict";

const sc = await import("../src/components/studio/useShortcuts.ts").catch((e) => { console.error(e); return null; });
if (!sc) {
  console.log("run with: node --experimental-strip-types scripts/verify-loop-guard.mjs");
  process.exit(1);
}
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("MIN_LOOP is half a second", () => assert.equal(sc.MIN_LOOP, 0.5));
ok("loop end at 0:00 does nothing", () => {
  assert.equal(sc.loopToEnd(0, 60, null), null);
  assert.equal(sc.loopToEnd(0.2, 60, null), null);
});
ok("loop start at the end of the song does nothing", () => {
  assert.equal(sc.loopFromStart(60, 60, null), null);
  assert.equal(sc.loopFromStart(59.8, 60, null), null);
});
ok("a playhead just past an existing loop edge does nothing", () => {
  assert.equal(sc.loopToEnd(10.1, 60, [10, 20]), null);
  assert.equal(sc.loopFromStart(19.9, 60, [10, 20]), null);
});
ok("ranges of at least MIN_LOOP are kept", () => {
  assert.deepEqual(sc.loopToEnd(0.5, 60, null), [0, 0.5]);
  assert.deepEqual(sc.loopFromStart(59.5, 60, null), [59.5, 60]);
  assert.deepEqual(sc.loopToEnd(10.5, 60, [10, 20]), [10, 10.5]);
  assert.deepEqual(sc.loopFromStart(19.5, 60, [10, 20]), [19.5, 20]);
});
ok("no song still does nothing", () => {
  assert.equal(sc.loopToEnd(5, 0, null), null);
  assert.equal(sc.loopFromStart(5, 0, null), null);
});

console.log(`\n${n} checks passed`);
