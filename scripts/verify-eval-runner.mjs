#!/usr/bin/env node
/**
 * Checks the cello eval runner survives a slow stage whose ready() throws (as it does when
 * public/models/basic-pitch is missing after `npm ci --ignore-scripts`): that stage is skipped
 * with the error as its note, the other stages still run, and the report is still written.
 * Also checks bp-node's hasCache() says "no" instead of throwing when the model folder is missing.
 *
 * Works on copies in a temporary folder, so the real stages, baselines and model are not touched.
 *
 * Run with: node --experimental-strip-types scripts/verify-eval-runner.mjs
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "eval-cello");
if (!existsSync(path.join(evalDir, "run.mjs"))) {
  console.log("run with: node --experimental-strip-types scripts/verify-eval-runner.mjs");
  process.exit(1);
}

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const tmp = mkdtempSync(path.join(tmpdir(), "riffscribe-eval-runner-"));
try {
  // --- run.mjs: a throwing ready() is a skip, not a crash
  const dir = path.join(tmp, "repo", "scripts", "eval-cello");
  mkdirSync(path.join(dir, "lib"), { recursive: true });
  mkdirSync(path.join(dir, "stages"), { recursive: true });
  copyFileSync(path.join(evalDir, "run.mjs"), path.join(dir, "run.mjs"));
  copyFileSync(path.join(evalDir, "lib", "ts-loader.mjs"), path.join(dir, "lib", "ts-loader.mjs"));
  writeFileSync(
    path.join(dir, "stages", "a-throws.mjs"),
    `export const name = "a-throws";\nexport const slow = true;\n` +
      `export async function ready() { throw new Error("ENOENT: no model folder"); }\n` +
      `export async function run() { throw new Error("run() must not be called"); }\n`
  );
  writeFileSync(
    path.join(dir, "stages", "b-not-ready.mjs"),
    `export const name = "b-not-ready";\nexport const slow = true;\n` +
      `export async function ready() { return false; }\n` +
      `export async function run() { throw new Error("run() must not be called"); }\n`
  );
  writeFileSync(
    path.join(dir, "stages", "c-fast.mjs"),
    `export const name = "c-fast";\n` +
      `export async function run() { return { metrics: { x: { value: 1, better: "higher", tol: 0 } }, gates: [] }; }\n`
  );

  const r = spawnSync(process.execPath, ["--experimental-strip-types", path.join(dir, "run.mjs"), "--ci"], { encoding: "utf8" });
  check("runner exits 0 when a slow stage's ready() throws", r.status === 0, r.status ? `exit ${r.status}\n${r.stdout}${r.stderr}` : "");

  const resFile = path.join(dir, "out", "results.json");
  check("results.json is written", existsSync(resFile));
  check("results.md is written", existsSync(path.join(dir, "out", "results.md")));
  if (existsSync(resFile)) {
    const res = JSON.parse(readFileSync(resFile, "utf8")).results;
    const by = Object.fromEntries(res.map((x) => [x.stage, x]));
    check("throwing stage is skipped", by["a-throws"]?.status === "skipped", by["a-throws"]?.status);
    check("skip note carries the error", /ready\(\) threw: ENOENT: no model folder/.test(by["a-throws"]?.note ?? ""), by["a-throws"]?.note);
    check("not-ready stage keeps the old note", by["b-not-ready"]?.note === "slow stage, inputs not cached (--ci)", by["b-not-ready"]?.note);
    check("fast stage after it still runs", by["c-fast"]?.status === "ok" && by["c-fast"]?.rows.length === 1, by["c-fast"]?.status);
  }

  // --- bp-node.cjs: hasCache() with no public/models/basic-pitch
  const libDir = path.join(tmp, "bare", "scripts", "eval-cello", "lib");
  mkdirSync(libDir, { recursive: true });
  copyFileSync(path.join(evalDir, "lib", "bp-node.cjs"), path.join(libDir, "bp-node.cjs"));
  const bp = createRequire(import.meta.url)(path.join(libDir, "bp-node.cjs"));
  let has, err = null;
  try { has = bp.hasCache(new Float32Array(16)); } catch (e) { err = e; }
  check("hasCache() does not throw without the model folder", !err, err && err.message);
  check("hasCache() is false without the model folder", has === false, String(has));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
