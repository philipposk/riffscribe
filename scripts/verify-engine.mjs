#!/usr/bin/env node
/**
 * Checks the practice engine's render cache and track handling against fake Web Audio:
 * a speed change mid-render, a second Play mid-render, the speed trainer stepping up,
 * a chart edit while playing, and the context surviving a reload of the tracks.
 *
 * Run with: node --experimental-strip-types scripts/verify-engine.mjs
 */
import { registerHooks } from "node:module";

/* ------------------------------------------------------------- fake audio */

const pending = []; // offline renders waiting to be let through
const rendered = []; // { id, rate } per finished offline render

const FAKE_STRETCH = `data:text/javascript,${encodeURIComponent(`
export function loadStretch() {
  return Promise.resolve(async (off) => {
    let input = null;
    off._node = {
      addBuffers: async (b) => { input = b; },
      connect() {},
      schedule: async (s) => { off._job = { input, rate: s.rate, semitones: s.semitones }; },
    };
    return off._node;
  });
}`)}`;

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "./stretchLoader" && ctx.parentURL?.endsWith("/engine.ts")) return { url: FAKE_STRETCH, shortCircuit: true };
    return next(spec, ctx);
  },
});

globalThis.window = { setInterval: () => 1 };
globalThis.OfflineAudioContext = class {
  constructor(ch, length, sampleRate) { this.length = length; this.sampleRate = sampleRate; this.destination = {}; }
  startRendering() {
    return new Promise((resolve) => {
      pending.push(() => {
        const { input, rate } = this._job;
        rendered.push({ input, rate });
        resolve({ length: this.length, rate, input });
      });
    });
  }
};
let contexts = 0;
globalThis.AudioContext = class {
  constructor() { contexts++; this.currentTime = 0; this.state = "running"; this.closed = false; this.destination = {}; this.sources = []; }
  async resume() { this.state = "running"; }
  async close() { this.closed = true; this.state = "closed"; }
  createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
  createBuffer(ch, length) { return { length, rate: 1, copyToChannel() {} }; }
  createBufferSource() {
    const src = { buffer: null, loop: false, started: null, stopped: false, connect() {}, disconnect() {},
      start(when, offset) { src.started = { when, offset }; }, stop() { src.stopped = true; } };
    this.sources.push(src);
    return src;
  }
};

const mod = await import("../src/lib/audio/engine.ts").catch((e) => { console.log(e); return null; });
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-engine.mjs");
  process.exit(1);
}
const { PracticeEngine } = mod;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Let every offline render through, including ones started by the ones before. */
async function flush() {
  for (let i = 0; i < 50; i++) {
    await tick();
    while (pending.length) pending.shift()();
  }
}
/** Let `n` offline renders through, one at a time. */
async function step(n = 1) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 20 && !pending.length; j++) await tick();
    pending.shift()?.();
    await tick();
  }
}

const SR = 1000;
const track = (id, n = 10 * SR) => ({ id, label: id, left: new Float32Array(n), right: new Float32Array(n) });
const playingBuffers = (e) => [...e.voices.values()].filter((v) => v.source).map((v) => v.source.buffer);

/* -------------------------------------------- 1. speed change mid-render */
{
  const e = new PracticeEngine();
  await e.load([track("a"), track("b"), track("c")], SR);
  await e.setRate(0.6);
  const playing = e.play(2);
  await step(1); // one of three tracks done at 0.6
  await e.setRate(0.7);
  await flush();
  await playing;
  const bufs = playingBuffers(e);
  check("speed change mid-render: playback uses one speed for every track",
    e.state().playing && bufs.length === 3 && bufs.every((b) => b.rate === 0.7), bufs.map((b) => b.rate).join(","));
  let consistent = true;
  for (const [k, map] of e.cache) for (const b of map.values()) if (b.rate.toFixed(3) !== k.split("|")[0]) consistent = false;
  check("speed change mid-render: every cached render matches its key", consistent);
  const src = [...e.voices.values()][0].source;
  check("speed change mid-render: started at the right place", Math.abs(src.started.offset - 2 / 0.7) < 1e-9, `${src.started.offset}`);
}

/* ---------------------------------------------- 2. second Play mid-render */
{
  rendered.length = 0;
  const e = new PracticeEngine();
  await e.load([track("a"), track("b")], SR);
  await e.setRate(0.5);
  const first = e.play(0);
  await step(1);
  const second = e.play(1);
  await flush();
  await Promise.all([first, second]);
  check("Play pressed again mid-render: the render is cached, not thrown away", e.cache.has("0.500|0"));
  await e.pause();
  rendered.length = 0;
  await e.play(0);
  check("…so the next Play renders nothing", rendered.length === 0, `${rendered.length} renders`);
}

/* ------------------------------------------- 3. speed trainer steps up */
{
  const e = new PracticeEngine();
  await e.load([track("a"), track("b")], SR);
  const p = e.play(0);
  await flush(); await p;
  let worst = 0;
  for (const r of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    void e.prepareRate(r + 0.05);
    const s = e.setRate(r);
    await flush(); await s;
    worst = Math.max(worst, e.cache.size);
  }
  check("speed trainer: at most two speeds are kept rendered", worst <= 2, `peak ${worst}`);
  check("speed trainer: the current speed is one of them", e.cache.has("0.800|0"));
}

/* -------------------------------------------- 4. chart edit while playing */
{
  const e = new PracticeEngine();
  const a = track("a"), g = track("guide:1"), click = track("click");
  await e.load([a, g, click], SR);
  await e.setRate(0.5);
  const p = e.play(3);
  await flush(); await p;
  const ctx = e.ctx;
  rendered.length = 0;
  e.ctx.currentTime = 1; // a second of playback = 0.5 s of song at 50%
  const g2 = track("guide:1");
  const u = e.updateTracks([a, g2, click, track("guide:2")], SR);
  await flush(); await u;
  check("chart edit: only the changed and new tracks are rendered again",
    rendered.length === 2 && rendered.every((r) => r.input[0] === g2.left || r.input[0].length === 10 * SR),
    `${rendered.length} renders`);
  check("chart edit: still playing, same audio context", e.state().playing && e.ctx === ctx && !ctx.closed);
  // started at 3 s, sources began 0.08 s after the call, 50% speed
  check("chart edit: carries on from where it had got to, not 0:00", Math.abs(e.anchorSong - (3 + (1 - 0.08) * 0.5)) < 1e-6, `${e.anchorSong}`);
  check("chart edit: the edited guide is what plays", playingBuffers(e).some((b) => b.input?.[0] === g2.left));

  rendered.length = 0;
  const u2 = e.updateTracks([a, click], SR);
  await flush(); await u2;
  check("removing tracks renders nothing and stops them", rendered.length === 0 && playingBuffers(e).length === 2);
}

/* ------------------------------------ 5. pause while a render is pending */
{
  const e = new PracticeEngine();
  await e.load([track("a")], SR);
  await e.setRate(0.8);
  const p = e.play(0);
  await tick();
  await e.pause();
  await flush(); await p;
  check("Pause during a render: playback does not start afterwards", !e.state().playing);
}

/* ------------------------------------------ 6. context kept across loads */
{
  const before = contexts;
  const e = new PracticeEngine();
  await e.load([track("a")], SR);
  const ctx = e.warm();
  check("warm() makes the context straight away, inside the click", contexts === before + 1 && e.ctx === ctx);
  await e.load([track("b")], SR);
  check("loading new tracks keeps the same, open context", e.ctx === ctx && !ctx.closed);
  await e.dispose();
  check("dispose closes it", ctx.closed && e.ctx === null);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall engine checks passed");
