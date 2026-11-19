#!/usr/bin/env node
/**
 * Checks how server routes learn who is calling (src/lib/supabase/server.ts).
 *
 * - The bearer header wins; the rs_at cookie is the fallback the assistant
 *   widget relies on.
 * - With the cookie turned off, only a bearer header counts, so a sibling
 *   *.6x7.gr page (which the browser still sends the cookie for) gets nobody.
 * - fromOtherOrigin flags any Sec-Fetch-Site other than same-origin, and lets
 *   requests without the header through (non-browser clients, old browsers).
 * - /api/withdraw refuses the cookie and other-origin requests.
 *
 * Run with: node --experimental-strip-types scripts/verify-auth-caller.mjs
 */
import { readFileSync } from "node:fs";

let mod;
try {
  mod = await import("../src/lib/supabase/server.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-auth-caller.mjs");
    process.exit(1);
  }
  throw e;
}
const { tokenFrom, fromOtherOrigin, AUTH_COOKIE } = mod;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

const req = (headers) => new Request("https://riffscribe.6x7.gr/api/withdraw", { method: "POST", headers });

check("bearer header is read", tokenFrom(req({ authorization: "Bearer abc" })) === "abc");
check("bearer wins over the cookie", tokenFrom(req({ authorization: "Bearer abc", cookie: `${AUTH_COOKIE}=xyz` })) === "abc");
check("cookie is the fallback by default", tokenFrom(req({ cookie: `a=1; ${AUTH_COOKIE}=x%2Ey` })) === "x.y");
check("a similarly named cookie is not taken", tokenFrom(req({ cookie: `x${AUTH_COOKIE}=nope` })) === null);
check("cookie refused when turned off", tokenFrom(req({ cookie: `${AUTH_COOKIE}=xyz` }), false) === null);
check("bearer still read when cookie is off", tokenFrom(req({ authorization: "bearer abc", cookie: `${AUTH_COOKIE}=xyz` }), false) === "abc");
check("nothing sent, nobody", tokenFrom(req({})) === null);

check("same-origin is allowed", fromOtherOrigin(req({ "sec-fetch-site": "same-origin" })) === false);
check("no Sec-Fetch-Site is allowed", fromOtherOrigin(req({})) === false);
check("same-site (sibling *.6x7.gr) is refused", fromOtherOrigin(req({ "sec-fetch-site": "same-site" })) === true);
check("cross-site is refused", fromOtherOrigin(req({ "sec-fetch-site": "cross-site" })) === true);

const route = readFileSync(new URL("../src/app/api/withdraw/route.ts", import.meta.url), "utf8");
check("/api/withdraw passes { cookie: false }", /caller\(req,\s*\{\s*cookie:\s*false\s*\}\)/.test(route));
check("/api/withdraw checks fromOtherOrigin before caller", route.indexOf("fromOtherOrigin(req)") > 0 && route.indexOf("fromOtherOrigin(req)") < route.indexOf("caller(req"));

console.log(failed ? `\n${failed} check(s) failed` : "\nall auth-caller checks passed");
process.exit(failed ? 1 : 0);
