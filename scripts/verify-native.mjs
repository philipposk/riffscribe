#!/usr/bin/env node
/**
 * Checks where sign-in comes back to, on the website and in the phone shell.
 *
 * - In the shell, Google and the email link both return on the custom scheme,
 *   so the WebView that holds the PKCE verifier finishes the sign-in.
 * - On the website both return to /studio on the same origin.
 * - Outside a browser (server, tests) nothing counts as the native shell.
 *
 * Run with: node --experimental-strip-types scripts/verify-native.mjs
 */
let native;
try {
  native = await import("../src/lib/native.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-native.mjs");
    process.exit(1);
  }
  throw e;
}

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

const { authRedirectTo, isNativePlatform, NATIVE_AUTH_REDIRECT } = native;
const site = "https://riffscribe.6x7.gr";

check("shell uses the custom scheme", authRedirectTo(true, site) === "gr.sixseven.riffscribe://auth/callback");
check("shell redirect is the exported constant", authRedirectTo(true, site) === NATIVE_AUTH_REDIRECT);
check("website returns to /studio", authRedirectTo(false, site) === `${site}/studio`, authRedirectTo(false, site));
check("website keeps a preview origin", authRedirectTo(false, "http://localhost:3000") === "http://localhost:3000/studio");
check("no window means not native", (await isNativePlatform()) === false);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall native checks passed");
