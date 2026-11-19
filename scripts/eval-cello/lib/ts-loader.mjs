/**
 * Lets Node import the app's TypeScript the way the bundler does: `src/` files import their
 * siblings without an extension ("./fft"), which Node will not resolve on its own.
 *
 * `registerHooks` is the in-thread form of a resolve hook (the same one the verify-*.mjs scripts
 * use), so it needs no separate loader file. Call it once, before the first import from `src/`.
 */
import { registerHooks } from "node:module";

let done = false;

export function registerTsLoader() {
  if (done) return;
  done = true;
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
      return next(spec, ctx);
    },
  });
}
