#!/usr/bin/env node
/**
 * Checks the site-level config without a build:
 * - response headers: cross-origin isolation only where the studio needs it, popups
 *   allowed elsewhere (Google sign-in), baseline hardening headers, ORT never "immutable"
 * - the required-asset check copy-assets.mjs uses to fail a build
 * - robots/sitemap/noindex for shared charts and /songs
 * - the assistant's llm.txt carries the plan limits from plans.ts
 *
 * Run with: node --experimental-strip-types scripts/verify-site-config.mjs
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) spec = pathToFileURL(join(root, "src", spec.slice(2) + ".ts")).href;
    return next(spec, ctx);
  },
});

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) { failed++; console.log("FAIL:", msg); } else console.log("ok:", msg);
};

// ── headers ──────────────────────────────────────────────────────────────────
const cfg = (await import("../next.config.ts")).default;
const rules = await cfg.headers();
/** Header value for a path, Next semantics: every matching rule applies, a later rule wins on the same key. */
function headersFor(path) {
  const out = {};
  for (const r of rules) {
    const src = r.source;
    const re = new RegExp(
      "^" + src.replace(/\/:path\*$/, "(?:/.*)?").replace("(.*)", "(.*)") + "$",
    );
    if (!re.test(path)) continue;
    for (const h of r.headers) out[h.key] = h.value;
  }
  return out;
}
const studio = headersFor("/studio");
ok(studio["Cross-Origin-Opener-Policy"] === "same-origin", "/studio keeps COOP same-origin");
ok(studio["Cross-Origin-Embedder-Policy"] === "credentialless", "/studio keeps COEP credentialless");
for (const p of ["/", "/account", "/pricing", "/songs", "/c/abc"]) {
  ok(headersFor(p)["Cross-Origin-Opener-Policy"] === "same-origin-allow-popups", `${p} COOP allows popups`);
  ok(!("Cross-Origin-Embedder-Policy" in headersFor(p)), `${p} has no COEP`);
}
for (const p of ["/", "/studio", "/account"]) {
  const h = headersFor(p);
  ok(h["X-Content-Type-Options"] === "nosniff", `${p} nosniff`);
  ok(h["X-Frame-Options"] === "DENY", `${p} X-Frame-Options`);
  ok(h["Content-Security-Policy"] === "frame-ancestors 'none'", `${p} frame-ancestors only`);
  ok(h["Referrer-Policy"] === "strict-origin-when-cross-origin", `${p} referrer policy`);
}
ok(!/immutable/.test(headersFor("/ort/ort-wasm-simd-threaded.jsep.wasm")["Cache-Control"] ?? ""), "/ort not immutable (fixed names)");
ok(/immutable/.test(headersFor("/models/basic-pitch/model.json")["Cache-Control"] ?? ""), "/models still immutable");

// ── isolation helpers ────────────────────────────────────────────────────────
const iso = await import("../src/lib/isolation.ts");
ok(iso.needsIsolatedReload({ isolated: false, initialPath: "/songs", currentPath: "/studio" }), "client-side arrival at the studio reloads");
ok(!iso.needsIsolatedReload({ isolated: false, initialPath: "/studio", currentPath: "/studio" }), "no reload loop after the reload");
ok(!iso.needsIsolatedReload({ isolated: true, initialPath: "/studio", currentPath: "/studio" }), "isolated studio does not reload");
ok(iso.googlePopupUsable({ isolated: false, fedcm: false }), "popup sign-in fine on non-isolated pages");
ok(!iso.googlePopupUsable({ isolated: true, fedcm: false }), "isolated page without FedCM uses redirect sign-in");
ok(iso.googlePopupUsable({ isolated: true, fedcm: true }), "isolated page with FedCM keeps Google button");

// ── required assets ──────────────────────────────────────────────────────────
const { missingAssets, REQUIRED_ASSETS } = await import("./assets-required.mjs");
const tmp = mkdtempSync(join(tmpdir(), "assets-"));
try {
  ok(missingAssets(tmp).length === REQUIRED_ASSETS.length, "empty public dir reports everything missing");
  for (const rel of REQUIRED_ASSETS) {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), "x");
  }
  ok(missingAssets(tmp).length === 0, "complete public dir reports nothing missing");
  rmSync(join(tmp, "ort/ort-wasm-simd-threaded.jsep.wasm"));
  ok(missingAssets(tmp).join().includes("ort-wasm-simd-threaded.jsep.wasm"), "a missing ORT wasm is named");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── robots / sitemap ─────────────────────────────────────────────────────────
const { default: sitemap } = await import("../src/app/sitemap.ts");
const urls = sitemap().map((e) => new URL(e.url).pathname);
ok(!urls.includes("/songs"), "sitemap omits /songs");
ok(urls.includes("/studio") && urls.includes("/pricing"), "sitemap keeps /studio and /pricing");
const noindex = (f) => /robots:\s*\{\s*index:\s*false/.test(readFileSync(join(root, f), "utf8"));
ok(noindex("src/app/c/[id]/page.tsx"), "shared chart page is noindex");
ok(noindex("src/app/songs/page.tsx"), "/songs page is noindex");

// ── llm.txt ──────────────────────────────────────────────────────────────────
const { PLANS } = await import("../src/lib/plans.ts");
const { GET } = await import("../src/app/llm.txt/route.ts");
const text = await GET().text();
ok(text.includes(`${PLANS.free.songs} saved songs`) && text.includes(`${PLANS.pro.songs} saved songs`), "llm.txt states song limits from plans.ts");
ok(text.includes(String(PLANS.free.assistant)) && text.includes(String(PLANS.pro.assistant)), "llm.txt states assistant limits from plans.ts");
ok(/sign(ed)?[- ]in/i.test(text) && /assistant/i.test(text) && text.includes("/pricing"), "llm.txt says the assistant needs sign-in and points to /pricing");
ok(text.includes("Audio is never uploaded"), "llm.txt keeps the audio promise");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
