/**
 * Loads Signalsmith Stretch at runtime instead of through the bundler.
 *
 * The library builds its AudioWorklet by calling `Function.prototype.toString()`
 * on its own WASM loader and shipping that source into the worklet. Any bundler
 * that renames or re-scopes that function breaks the trick: the worklet never
 * finishes initialising and every call just hangs. Importing the untouched ESM
 * file straight from /vendor keeps the source self-contained.
 *
 * `scripts/copy-assets.mjs` puts the file in public/vendor at install time.
 */
import type { StretchNode } from "signalsmith-stretch";

export type { StretchNode };

type Factory = (ctx: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>;

const VENDOR_URL = "/vendor/SignalsmithStretch.mjs";

let cached: Promise<Factory> | null = null;

export function loadStretch(): Promise<Factory> {
  if (!cached) {
    cached = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ VENDOR_URL).then(
      (m: { default: Factory }) => m.default
    );
  }
  return cached;
}
