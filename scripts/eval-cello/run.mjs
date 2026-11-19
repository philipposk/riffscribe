#!/usr/bin/env node
/**
 * Eval runner. Finds every stages/*.mjs, runs it, compares the numbers with that stage's
 * committed baseline (baselines/<stage>.json) and exits 1 when something got worse.
 *
 *   node --experimental-strip-types scripts/eval-cello/run.mjs [--ci] [--only=name]
 *                                                              [--update-baseline[=name]]
 *
 *   --ci                      skip stages marked slow unless their inputs are already cached
 *   --only=<name>             run one stage
 *   --update-baseline[=name]  write today's numbers as the new baseline (all stages run, or one)
 *
 * A stage is `{ name, slow?, ready?(ctx), run(ctx) }` and `run` returns
 *   { metrics: { key: { value, better: "higher"|"lower", tol, info? } },
 *     gates:   [{ key, op: "<="|">="|"==", value }] }
 * or `{ skipped: "reason" }`. A metric fails when it is worse than its baseline by more than
 * `tol`; `info: true` records a number without ever comparing it. A stage with no baseline file
 * passes and says so.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { registerTsLoader } from "./lib/ts-loader.mjs";

registerTsLoader();

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const stagesDir = path.join(here, "stages");
const baselinesDir = path.join(here, "baselines");
const outDir = path.join(here, "out");

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const ci = !!flag("ci");
const only = flag("only")?.split("=")[1] ?? null;
const upd = flag("update-baseline");
const updateAll = upd === "--update-baseline";
const updateOnly = upd && upd.includes("=") ? upd.split("=")[1] : null;

const ctx = {
  ci,
  repoRoot,
  outDir,
  cacheDir: path.join(here, ".cache"),
  /** Folder with downloaded evaluation sets (vocadito/, musdb7/); null when the variable is not set. */
  dataDir: process.env.RIFFSCRIBE_EVAL_DATA || null,
  log: (...a) => console.log("   ", ...a),
};

const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")) : String(v));

function gateOk(op, a, b) {
  if (op === "<=") return a <= b;
  if (op === ">=") return a >= b;
  if (op === "==") return a === b;
  throw new Error(`unknown gate operator ${op}`);
}

const files = readdirSync(stagesDir).filter((f) => f.endsWith(".mjs")).sort();
const stages = [];
for (const f of files) stages.push(await import(pathToFileURL(path.join(stagesDir, f)).href));

const results = [];
let failed = false;
mkdirSync(outDir, { recursive: true });

for (const stage of stages) {
  if (only && stage.name !== only) continue;
  const rec = { stage: stage.name, slow: !!stage.slow, status: "ok", rows: [], gates: [], note: "" };
  results.push(rec);
  console.log(`\n== ${stage.name}${stage.slow ? " (slow)" : ""}`);

  if (stage.slow && ci && !(stage.ready && (await stage.ready(ctx)))) {
    rec.status = "skipped";
    rec.note = "slow stage, inputs not cached (--ci)";
    console.log(`   skipped: ${rec.note}`);
    continue;
  }

  const t0 = performance.now();
  let out;
  try {
    out = await stage.run(ctx);
  } catch (e) {
    rec.status = "error";
    rec.note = e instanceof Error ? e.stack || e.message : String(e);
    failed = true;
    console.log(`   ERROR: ${rec.note}`);
    continue;
  }
  rec.seconds = Math.round((performance.now() - t0) / 100) / 10;

  if (out.skipped) {
    rec.status = "skipped";
    rec.note = out.skipped;
    console.log(`   skipped: ${rec.note}`);
    continue;
  }

  const baseFile = path.join(baselinesDir, `${stage.name}.json`);
  const base = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, "utf8")).metrics ?? {} : null;
  if (!base) console.log("   no baseline");

  for (const [key, m] of Object.entries(out.metrics)) {
    const b = base && key in base ? base[key] : null;
    let verdict = "new";
    if (!Number.isFinite(m.value)) verdict = "FAIL (not a number)";
    else if (m.info) verdict = "info";
    else if (b != null) {
      const worse = m.better === "higher" ? m.value < b - m.tol : m.value > b + m.tol;
      const better = m.better === "higher" ? m.value > b + m.tol : m.value < b - m.tol;
      verdict = worse ? "FAIL (worse)" : better ? "better" : "ok";
    } else if (base) verdict = "new (no baseline value)";
    if (verdict.startsWith("FAIL")) { rec.status = "FAIL"; failed = true; }
    rec.rows.push({ key, value: m.value, baseline: b, delta: b != null && Number.isFinite(m.value) ? m.value - b : null, better: m.better, tol: m.tol, verdict });
    console.log(`   ${key.padEnd(28)} ${fmt(m.value).padStart(10)}  base ${b == null ? "-" : fmt(b)}  ${verdict}`);
  }
  for (const g of out.gates ?? []) {
    const m = out.metrics[g.key];
    const ok = !!m && gateOk(g.op, m.value, g.value);
    rec.gates.push({ ...g, actual: m?.value ?? null, ok });
    if (!ok) { rec.status = "FAIL"; failed = true; }
    console.log(`   gate ${g.key} ${g.op} ${g.value}: ${ok ? "ok" : "FAIL"} (got ${m ? fmt(m.value) : "missing"})`);
  }

  if (updateAll || updateOnly === stage.name) {
    mkdirSync(baselinesDir, { recursive: true });
    const metrics = Object.fromEntries(Object.entries(out.metrics).map(([k, m]) => [k, m.value]));
    writeFileSync(baseFile, JSON.stringify({ stage: stage.name, metrics }, null, 2) + "\n");
    console.log(`   baseline written: baselines/${stage.name}.json`);
  }
}

// reports
writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ ci, results }, null, 2));
let md = `# Cello eval results\n\n${failed ? "**FAILED**" : "Passed"}${ci ? " (ci mode)" : ""}\n`;
for (const r of results) {
  md += `\n## ${r.stage}${r.slow ? " (slow)" : ""}: ${r.status}${r.seconds != null ? ` (${r.seconds}s)` : ""}\n\n`;
  if (r.note) md += `${r.note.split("\n")[0]}\n\n`;
  if (r.rows.length) {
    md += "| metric | value | baseline | delta | verdict |\n|---|---:|---:|---:|---|\n";
    for (const x of r.rows) md += `| ${x.key} | ${fmt(x.value)} | ${x.baseline == null ? "-" : fmt(x.baseline)} | ${x.delta == null ? "-" : fmt(x.delta)} | ${x.verdict} |\n`;
  }
  for (const g of r.gates) md += `\nGate \`${g.key} ${g.op} ${g.value}\`: ${g.ok ? "ok" : "FAIL"} (got ${g.actual == null ? "missing" : fmt(g.actual)})\n`;
}
writeFileSync(path.join(outDir, "results.md"), md);
console.log(`\n${failed ? "FAILED" : "ok"}: wrote scripts/eval-cello/out/results.md`);
process.exit(failed ? 1 : 0);
