#!/usr/bin/env node
/**
 * Checks the studio's keyboard shortcuts (which key does what, which keys are left
 * to fields, sliders, dialogs and the assistant, the loop and speed rules) and the
 * error sentences.
 *
 * Run with: node --experimental-strip-types scripts/verify-studio-ux.mjs
 */
import assert from "node:assert/strict";

const sc = await import("../src/components/studio/useShortcuts.ts").catch((e) => { console.error(e); return null; });
const er = await import("../src/components/studio/errors.ts").catch((e) => { console.error(e); return null; });
if (!sc || !er) {
  console.log("run with: node --experimental-strip-types scripts/verify-studio-ux.mjs");
  process.exit(1);
}
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

const key = (k, o = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...o });
const act = (k, o) => sc.shortcutFor(key(k, o))?.action ?? null;

// ---- mapping
ok("space and page down play or pause", () => {
  assert.equal(act(" "), "playPause");
  assert.equal(act("PageDown"), "playPause");
});
ok("page up goes back to the loop start, home too", () => {
  assert.equal(act("PageUp"), "restartLoop");
  assert.equal(act("Home"), "home");
});
ok("arrows seek, brackets set the loop, L clears it", () => {
  assert.equal(act("ArrowLeft"), "back");
  assert.equal(act("ArrowRight"), "forward");
  assert.equal(act("["), "loopStart");
  assert.equal(act("]"), "loopEnd");
  assert.equal(act("l"), "clearLoop");
  assert.equal(act("L", { shiftKey: true }), "clearLoop");
});
ok("minus and equals change speed, plus too", () => {
  assert.equal(act("-"), "slower");
  assert.equal(act("="), "faster");
  assert.equal(act("+", { shiftKey: true }), "faster");
});
ok("digits pick a section", () => {
  assert.deepEqual(sc.shortcutFor(key("3")), { action: "section", n: 3 });
  assert.equal(act("0"), null);
});
ok("F, M, V and ? toggle follow, guides, vocals, help", () => {
  assert.equal(act("f"), "follow");
  assert.equal(act("m"), "muteGuides");
  assert.equal(act("v"), "muteVocals");
  assert.equal(act("?", { shiftKey: true }), "help");
});
ok("cmd/ctrl+Z undoes; other modified keys are the browser's", () => {
  assert.equal(act("z", { metaKey: true }), "undo");
  assert.equal(act("z", { ctrlKey: true }), "undo");
  assert.equal(act("z", { metaKey: true, shiftKey: true }), null);
  assert.equal(act(" ", { ctrlKey: true }), null);
  assert.equal(act("m", { altKey: true }), null);
  assert.equal(act("f", { metaKey: true }), null);
});
ok("held keys repeat for seeking and speed only", () => {
  assert.equal(act("ArrowRight", { repeat: true }), "forward");
  assert.equal(act("=", { repeat: true }), "faster");
  assert.equal(act(" ", { repeat: true }), null);
  assert.equal(act("m", { repeat: true }), null);
});
ok("unrelated keys do nothing", () => {
  assert.equal(act("q"), null);
  assert.equal(act("Enter"), null);
  assert.equal(act("Tab"), null);
});

// ---- whose key it is
const el = (tagName, attrs = {}, extra = {}) => ({
  tagName,
  getAttribute: (a) => (a in attrs ? attrs[a] : null),
  ...extra,
});
const body = el("BODY");
ok("keys typed into fields are the field's", () => {
  for (const t of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(sc.ownedByTarget([el(t), body], "m"), true, t);
  assert.equal(sc.ownedByTarget([el("DIV", { contenteditable: "true" }), body], "m"), true);
  assert.equal(sc.ownedByTarget([el("DIV", {}, { isContentEditable: true }), body], "m"), true);
});
ok("sliders and open dialogs keep their keys", () => {
  assert.equal(sc.ownedByTarget([el("DIV", { role: "slider" }), body], "ArrowLeft"), true);
  assert.equal(sc.ownedByTarget([el("BUTTON"), el("DIALOG"), body], "m"), true);
});
ok("the assistant keeps its keys (its host, or any shadow-DOM host)", () => {
  assert.equal(sc.ownedByTarget([el("DIV", {}, { id: sc.ASSISTANT_HOST_ID }), body], " "), true);
  assert.equal(sc.ownedByTarget([el("SPAN"), el("DIV", {}, { shadowRoot: {} }), body], "m"), true);
});
ok("space on a focused button presses the button, other keys are ours", () => {
  assert.equal(sc.ownedByTarget([el("BUTTON"), body], " "), true);
  assert.equal(sc.ownedByTarget([el("DIV", { role: "button" }), body], " "), true);
  assert.equal(sc.ownedByTarget([el("BUTTON"), body], "m"), false);
  assert.equal(sc.ownedByTarget([body, { nodeType: 9 }, {}], " "), false);
});

// ---- loop and speed rules
ok("loop start at the playhead keeps a later end, or loops the next 4 s", () => {
  assert.deepEqual(sc.loopFromStart(10, 60, [5, 20]), [10, 20]);
  assert.deepEqual(sc.loopFromStart(10, 60, [2, 8]), [10, 14]);
  assert.deepEqual(sc.loopFromStart(58, 60, null), [58, 60]);
  assert.equal(sc.loopFromStart(1, 0, null), null);
});
ok("loop end at the playhead keeps an earlier start, or loops the last 4 s", () => {
  assert.deepEqual(sc.loopToEnd(10, 60, [5, 20]), [5, 10]);
  assert.deepEqual(sc.loopToEnd(10, 60, [12, 20]), [6, 10]);
  assert.deepEqual(sc.loopToEnd(2, 60, null), [0, 2]);
});
ok("speed steps 5% on the grid, within 25-150%", () => {
  assert.equal(sc.stepRate(1, -1), 0.95);
  assert.equal(sc.stepRate(1, 1), 1.05);
  assert.equal(sc.stepRate(0.25, -1), 0.25);
  assert.equal(sc.stepRate(1.5, 1), 1.5);
  assert.equal(sc.stepRate(0.97, 1), 1);
});
ok("the help list names every key the mapping knows", () => {
  const listed = sc.SHORTCUT_HELP.flatMap((h) => h.keys).join(" ");
  for (const k of ["Space", "Home", "←", "→", "[", "]", "L", "-", "=", "F", "M", "V", "Z", "?", "Page Down", "Page Up"]) {
    assert.ok(listed.includes(k), k);
  }
});

// ---- error sentences
ok("an error becomes a sentence with a next step, original kept in brackets", () => {
  const msg = er.humanError(new Error("Demucs OOM"), "split");
  assert.match(msg, /^The split did not finish\. .*trim the song to your loop/);
  assert.ok(msg.endsWith("(Demucs OOM)"));
});
ok("every context has its own sentence", () => {
  const seen = new Set();
  for (const c of ["decode", "split", "transcribe", "engine", "record", "chart"]) {
    const m = er.humanError(null, c);
    assert.ok(m.length > 30 && !m.includes("("), c);
    seen.add(m);
  }
  assert.equal(seen.size, 6);
});
ok("strings are kept, empty details are dropped", () => {
  assert.ok(er.humanError("timeout", "chart").endsWith("(timeout)"));
  assert.ok(!er.humanError(new Error("  "), "engine").includes("("));
});

console.log(`\n${n} checks passed`);
