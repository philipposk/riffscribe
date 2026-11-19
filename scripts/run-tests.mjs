#!/usr/bin/env node
/**
 * Runs every scripts/verify-*.mjs in turn, then the cello eval (if it exists) in CI mode.
 *
 * A script fails the run if it exits non-zero, or if it prints a line starting
 * "run with" (what the old scripts printed when they could not load their code
 * and then exited 0). The cello eval runs with --ci; its slow stages need
 * RIFFSCRIBE_EVAL_DATA and skip when it is unset.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(root, "scripts");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const verify = readdirSync(scripts)
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .sort()
  .filter((f) => !only.length || only.some((o) => f.includes(o)));

const failures = [];

function run(label, args) {
  console.log(`\n=== ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  process.stdout.write(out);
  const unloaded = out.split(/\r?\n/).some((l) => l.startsWith("run with"));
  if (r.status !== 0 || r.error || unloaded) {
    const why = r.error ? String(r.error) : unloaded ? "could not load its code" : `exit ${r.status ?? r.signal}`;
    console.log(`FAILED: ${label} (${why})`);
    failures.push(label);
  }
}

for (const f of verify) run(`scripts/${f}`, ["--experimental-strip-types", join("scripts", f)]);

const evalRun = join(scripts, "eval-cello", "run.mjs");
if (!only.length && existsSync(evalRun)) {
  run("scripts/eval-cello/run.mjs --ci", ["--experimental-strip-types", join("scripts", "eval-cello", "run.mjs"), "--ci"]);
}

console.log(`\n${verify.length} verify script(s) run, ${failures.length} failed${failures.length ? `: ${failures.join(", ")}` : ""}`);
process.exit(failures.length ? 1 : 0);
