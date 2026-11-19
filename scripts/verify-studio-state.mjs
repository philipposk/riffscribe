#!/usr/bin/env node
/**
 * Checks the studio's small state decisions and the chart save fallback:
 * chart link on song change, settings kept per song, stale solo, trainer steps,
 * and "Saved." only when a row was really written.
 *
 * Run with: node --experimental-strip-types scripts/verify-studio-state.mjs
 */
import assert from "node:assert/strict";

const st = await import("../src/lib/studioState.ts").catch(() => null);
const cs = await import("../src/lib/store/chartSave.ts").catch(() => null);
if (!st || !cs) {
  console.log("run with: node --experimental-strip-types scripts/verify-studio-state.mjs");
  process.exit(1);
}
let n = 0;
const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log("ok -", name); });

// ---- chart link
await ok("same song keeps the chart link", () => assert.equal(st.keepChartLink("a", "a"), true));
await ok("another song drops it", () => assert.equal(st.keepChartLink("a", "b"), false));
await ok("a chart with no song key never keeps it", () => assert.equal(st.keepChartLink(null, "b"), false));

// ---- settings per song
const good = { settings: { bpm: 96, offsetSeconds: 0.4, capo: 2 }, sections: [{ name: "solo", from: 1, to: 2 }], loop: [3, 9] };
await ok("saved settings read back", () => assert.deepEqual(st.readSavedSettings(good), good));
await ok("garbage is ignored", () => {
  assert.equal(st.readSavedSettings(null), null);
  assert.equal(st.readSavedSettings({ settings: { bpm: "x" } }), null);
  assert.equal(st.readSavedSettings([1, 2]), null);
});
await ok("bad loop and sections are dropped, settings kept", () => {
  const r = st.readSavedSettings({ settings: good.settings, sections: "no", loop: [5, 1] });
  assert.deepEqual(r.sections, []);
  assert.equal(r.loop, null);
  assert.equal(r.settings.bpm, 96);
});
const tempo = { bpm: 120, offsetSeconds: 0 };
await ok("a returning song gets its 96 BPM, not the detected tempo", () => {
  const r = st.settingsOnLoad(st.readSavedSettings(good), false, { bpm: 100, offsetSeconds: 0.1 });
  assert.equal(r.kind, "saved");
  assert.equal(r.value.settings.bpm, 96);
});
await ok("a song seen for the first time gets the detected tempo", () =>
  assert.deepEqual(st.settingsOnLoad(null, false, tempo), { kind: "detected", ...tempo }));
await ok("an opened chart keeps its own settings", () =>
  assert.equal(st.settingsOnLoad(st.readSavedSettings(good), true, tempo).kind, "chart"));

// ---- solo
await ok("stale solo is no solo", () => {
  assert.equal(st.liveSolo("vocals", ["original", "click"]), null);
  assert.equal(st.liveSolo("vocals", ["vocals"]), "vocals");
  assert.equal(st.liveSolo(null, ["vocals"]), null);
});

// ---- trainer
await ok("trainer steps up, stops at the target, then finishes", () => {
  const t = { step: 0.05, target: 0.75 };
  assert.deepEqual(st.trainerStep(0.5, t), { kind: "up", rate: 0.55 });
  assert.deepEqual(st.trainerStep(0.72, t), { kind: "up", rate: 0.75 });
  assert.deepEqual(st.trainerStep(0.75, t), { kind: "done" });
  assert.deepEqual(st.trainerStep(0.9, t), { kind: "done" });
});

// ---- saveChart
function fakeClient({ updateRows, updateError, insertError }) {
  const calls = [];
  return {
    calls,
    from: () => ({
      update: (v) => ({
        eq: (_c, id) => ({
          select: () => ({
            maybeSingle: async () => {
              calls.push(["update", id]);
              return { data: updateRows ? { id } : null, error: updateError ?? null };
            },
          }),
        }),
      }),
      insert: (v) => ({
        select: () => ({
          single: async () => {
            calls.push(["insert", v.owner]);
            return insertError ? { data: null, error: insertError } : { data: { id: "new-1" }, error: null };
          },
        }),
      }),
    }),
  };
}
const chart = { title: "T", data: 1 };
await ok("update that wrote a row returns the same id", async () => {
  const c = fakeClient({ updateRows: true });
  assert.equal(await cs.writeChart(c, "me", chart, "x"), "x");
  assert.deepEqual(c.calls, [["update", "x"]]);
});
await ok("update that matched nothing saves a new chart instead", async () => {
  const c = fakeClient({ updateRows: false });
  assert.equal(await cs.writeChart(c, "me", chart, "x"), "new-1");
  assert.deepEqual(c.calls, [["update", "x"], ["insert", "me"]]);
});
await ok("update error is thrown, not swallowed", async () => {
  const c = fakeClient({ updateError: new Error("boom") });
  await assert.rejects(cs.writeChart(c, "me", chart, "x"), /boom/);
  assert.deepEqual(c.calls, [["update", "x"]]);
});
await ok("no id inserts", async () => {
  const c = fakeClient({});
  assert.equal(await cs.writeChart(c, "me", chart), "new-1");
});
await ok("song limit message applies to the fallback insert too", async () => {
  const c = fakeClient({ updateRows: false, insertError: { message: "riffscribe_song_limit exceeded" } });
  await assert.rejects(cs.writeChart(c, "me", chart, "x"), /song limit/);
});

console.log(`\n${n} checks passed`);
