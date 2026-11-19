#!/usr/bin/env node
/**
 * Checks the tensor scoping the transcription runner uses in place of tf.tidy:
 * every tensor made inside a scope is disposed except the ones handed back,
 * which survive until the caller disposes them, including when the work
 * throws and when two runs prepare their input at the same time.
 *
 * The engine here is a stand-in with the same scope rules as TensorFlow.js
 * 3.x's (startScope / endScope / keep / track), since TensorFlow may not be
 * imported outside the eval harness.
 *
 * Run with: node --experimental-strip-types scripts/verify-runner-scope.mjs
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const runner = await import("../src/lib/transcribe/runner.ts").catch((e) => {
  console.log(e.message);
  return null;
});
if (!runner) {
  console.log("run with: node --experimental-strip-types scripts/verify-runner-scope.mjs");
  process.exit(1);
}
const { tensorEngine, scoped, scopedAsync } = runner;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail !== undefined ? `: ${detail}` : ""}`);
};

/** Same rules as tfjs-core's Engine: track only inside a scope; endScope disposes what is not kept or returned. */
function fakeEngine() {
  const stack = [];
  let active = null;
  const live = new Set();
  const eng = {
    live,
    depth: () => stack.length,
    maxDepth: 0,
    make(name) {
      const t = { name, kept: false, disposed: false, dispose() { this.disposed = true; live.delete(this); } };
      live.add(t);
      if (active) active.push(t);
      return t;
    },
    startScope() {
      active = [];
      stack.push(active);
      eng.maxDepth = Math.max(eng.maxDepth, stack.length);
    },
    endScope(result) {
      const keepIds = new Set(Array.isArray(result) ? result : result ? [result] : []);
      for (const t of active) if (!t.kept && !keepIds.has(t)) t.dispose();
      stack.pop();
      active = stack.length ? stack[stack.length - 1] : null;
      for (const t of keepIds) if (!t.kept && active) active.push(t);
    },
    keep(t) {
      t.kept = true;
      return t;
    },
  };
  return eng;
}

/* ------------------------------------------------- finding the engine */
{
  check("no engine on the global: null", tensorEngine({}) === null);
  check("something that is not an engine: null", tensorEngine({ _tfengine: { startScope() {} } }) === null);
  const eng = fakeEngine();
  check("the engine Basic Pitch registered is found", tensorEngine({ _tfengine: eng }) === eng);
}

/* ------------------------------------------------- one window */
{
  const eng = fakeEngine();
  // What a window makes: batch slice, three model outputs, an unwrap slice per output, three reshapes.
  const [a, b, c] = scoped(eng, () => {
    eng.make("batch");
    const outs = ["f", "o", "c"].map((n) => eng.make(n));
    return outs.map((o) => (eng.make(`${o.name}-raw`), eng.make(`${o.name}-unwrapped`)));
  });
  check("only the three returned tensors are still alive", eng.live.size === 3 && [a, b, c].every((t) => eng.live.has(t)), [...eng.live].map((t) => t.name).join(","));
  check("the scope is closed", eng.depth() === 0);
  for (const t of [a, b, c]) t.dispose();
  check("nothing is left once the caller frees them", eng.live.size === 0);
}

/* ------------------------------------------------- a window that throws */
{
  const eng = fakeEngine();
  let threw = false;
  try {
    scoped(eng, () => {
      eng.make("batch");
      eng.make("f");
      throw new Error("model failed");
    });
  } catch {
    threw = true;
  }
  check("the error still reaches the caller", threw);
  check("everything it made is freed and the scope closed", eng.live.size === 0 && eng.depth() === 0);
}

/* ------------------------------------------------- no engine */
{
  const out = scoped(null, () => [{ n: 1 }]);
  check("without an engine the work still runs", out[0].n === 1);
}

/* ------------------------------------------------- an inner scope inside an outer one */
{
  const eng = fakeEngine();
  eng.startScope(); // someone else's scope, open around ours
  const [kept] = scoped(eng, () => (eng.make("tmp"), [eng.make("out")]));
  eng.endScope();
  check("a returned tensor survives the scope around it too", eng.live.has(kept) && eng.live.size === 1);
}

/* ------------------------------------------------- preparing the input */
{
  const eng = fakeEngine();
  // Like prepareData: all the work is done before it returns; the result is reachable only by awaiting.
  const prepare = (tag) => {
    eng.make(`${tag}-zeros`);
    eng.make(`${tag}-audio`);
    eng.make(`${tag}-concat`);
    const frame = eng.make(`${tag}-frame`);
    const input = eng.make(`${tag}-input`);
    return Promise.resolve([input, 1000, frame]);
  };
  const [[inA], [inB]] = await Promise.all([
    scopedAsync(eng, () => prepare("a"), ([input]) => [input]),
    scopedAsync(eng, () => prepare("b"), ([input]) => [input]),
  ]);
  check("two at once: only each run's input survives", eng.live.size === 2 && eng.live.has(inA) && eng.live.has(inB), [...eng.live].map((t) => t.name).join(","));
  check("their scopes never overlap", eng.maxDepth === 1, eng.maxDepth);
  check("all scopes closed", eng.depth() === 0);

  let threw = false;
  try {
    await scopedAsync(eng, async () => {
      eng.make("partial");
      throw new Error("bad audio");
    }, () => []);
  } catch {
    threw = true;
  }
  check("a failed prepare frees what it made and rethrows", threw && eng.live.size === 2 && eng.depth() === 0);
  const [after] = await scopedAsync(eng, () => prepare("c"), ([input]) => [input]);
  check("and does not block the next one", eng.live.has(after));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall runner scope checks passed");
