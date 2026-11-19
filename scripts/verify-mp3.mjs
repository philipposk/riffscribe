#!/usr/bin/env node
/**
 * Checks MP3 export encodes at all. Plain `lamejs` 1.2.1 threw "MPEGMode is not defined" on the
 * first encoder, so every MP3 export failed; the app now uses the @breezystack/lamejs fork.
 *
 * Run with: node --experimental-strip-types scripts/verify-mp3.mjs
 */
let mp3;
try {
  mp3 = await import("../src/lib/audio/mp3.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-mp3.mjs");
    process.exit(1);
  }
  throw e;
}

let failed = 0;
function check(label, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed++;
}

const left = new Float32Array(1152);
const right = new Float32Array(1152);
for (let i = 0; i < 1152; i++) {
  left[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
  right[i] = Math.sin((2 * Math.PI * 660 * i) / 44100) * 0.5;
}

let blob = null;
try {
  blob = mp3.encodeMp3([left, right], 44100);
} catch (e) {
  console.log(`encodeMp3 threw: ${e instanceof Error ? e.message : String(e)}`);
}
check("encodeMp3 returns a non-empty blob for two 1152-sample channels at 44.1 kHz", !!blob && blob.size > 0);
check("the blob is audio/mpeg", blob?.type === "audio/mpeg");

let mono = null;
try {
  mono = mp3.encodeMp3([left], 44100);
} catch (e) {
  console.log(`encodeMp3 (mono) threw: ${e instanceof Error ? e.message : String(e)}`);
}
check("one channel is encoded as stereo without throwing", !!mono && mono.size > 0);

if (blob) {
  const head = new Uint8Array(await blob.arrayBuffer());
  check("the data starts with an MPEG frame sync", head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
