# Riffscribe: rules for the coding agent

Riffscribe turns a song or a recording into a chart, a score and play-along practice tracks, in the browser, and can replace a singer with a cello. Next.js app, Supabase for accounts and saved charts, Stripe for billing, Claude (with OpenRouter as the fallback) for the assistant. Read `HANDOFF.md` first: it explains how the audio engine works and why. The map is `docs/architecture.md`; the voice-to-cello pipeline is `docs/voice-to-cello.md`; the evaluation harness is `docs/eval-cello.md`.

## Always

- `main` deploys to production on every push (Vercel). Never push to `main`. Work on a branch, open a pull request, merge only when the `Tests` check is green. The Vercel Hobby deploy cap is shared across the whole account, so push a branch once when it is ready, not after every commit.
- Run these before saying a task is done, and say what you did not run:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` (the `scripts/verify-*.mjs` scripts and the cello eval in `--ci` mode). When you change anything in the voice path (notes, contour, register, guide, split) also run `npm run eval:cello`, with `RIFFSCRIBE_EVAL_DATA` set when you can so the real-singing stages run; a number that gets worse fails the run, and a number that is meant to move needs its baseline updated in the same change
  - `npm run build` with `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder`
- Add or update a verify script or an eval stage for every piece of logic. A verify script that cannot load its code must exit 1, never 0.
- Keep each pull request at 150 changed files or fewer (CodeRabbit skips bigger ones). Ship a bigger change as a stack of pull requests.
- Commits are normal prose. Never add a Claude co-author line or footer to a commit or a pull request.
- The evaluation recordings (vocadito, MUSDB18-7s) stay outside the repo, in the folder `RIFFSCRIBE_EVAL_DATA` points at. MUSDB18-7s is non-commercial: never commit, copy or redistribute it. Only aggregate numbers go into `scripts/eval-cello/baselines/`.
- Never open, print or search `.env.local` or any other `.env` file except `.env.example`. Never commit keys: `node scripts/secret-scan.mjs` must pass.
- Never put a secret behind `NEXT_PUBLIC_`: that prefix publishes the value to every visitor.
- Touch only the files your task needs. If a task seems to need another area's file, stop and say so.
- Never start a dev server or a background build for someone else; they run those.

## Database

- Every database object is prefixed `riffscribe_` (gotcha 7). The 6x7 project is shared by many apps in one `public` schema.
- Change the database only with a new numbered file in `supabase/migrations/`, idempotent (`if not exists`, `drop policy if exists` before `create policy`, `create or replace`). Never edit a migration that has already run.
- Every table has row level security on, with one policy per action limited to the owner.
- Code that reads a table or function a migration adds must still work when that migration has not run yet: treat the database error as "not admin", "default settings", "no stored customer", "skip logging".
- Migrations `0003` to `0007` exist; a new one is `0008` or later. The order to apply them, and which must wait for a deploy, is `supabase/README.md`. A new migration must be compatible with all of them.

## Hard limits from the gotchas below (G1 is gotcha 1, and so on)

- G1/G2: never touch `stretchLoader.ts` or the offline-render path in `engine.ts`.
- G3/G9/G10: no `@tensorflow/tfjs` import under `src/`; the only allowed place is `scripts/eval-cello/lib/bp-node.cjs`. Do not change the transcription worker's `window` shim or the frame arithmetic.
- G5: no second AudioContext, no alphaTab synth.
- G6: no new cross-origin fetches.
- G7: every SQL object is prefixed `riffscribe_`.
- G11: leave the `lendStudio` effect and `AssistantHost` mounting exactly as they are.
- G12: the guide is rendered at sounding pitch. Never pass the written key or a transpose to the guide synth.
- G13: `@tensorflow/tfjs` is importable only in `scripts/eval-cello/lib/bp-node.cjs`.
- Package bumps: no major upgrade of `next`, `react`, `@spotify/basic-pitch`, `@tensorflow/tfjs`, `onnxruntime-web`, `demucs-web`, `signalsmith-stretch` or `@coderline/alphatab` without testing the studio in a browser (audio, split, transcription, score).

## Hard-won gotchas — read before touching audio

Each of these cost real debugging time and each will come straight back if the
code is "cleaned up" past them.

1. **Signalsmith Stretch must not go through the bundler.** It builds its
   AudioWorklet by calling `Function.prototype.toString()` on its own WASM
   loader; any bundler renames the closure and the worklet silently never
   becomes ready — every call hangs with no error. It is copied to
   `public/vendor/` by `copy-assets.mjs` and imported at runtime with
   `/* turbopackIgnore: true */` (`src/lib/audio/stretchLoader.ts`).

2. **The realtime stretch worklet is not used, on purpose.** Depending on when
   and how the AudioContext was created it comes up producing silence and never
   advancing, and once wedged it reports a negative position forever. Reproduced
   with one node, with several, and with the library's own `start()`. The same
   library renders *offline* perfectly, so `engine.ts` pre-renders speed/pitch
   changes into plain AudioBuffers and plays them with ordinary buffer sources.
   100% speed with no transpose skips rendering entirely.

3. **Do not import TensorFlow.js anywhere.** Basic Pitch carries its own copy
   and makes its tensors through it. A second instance means tensors created by
   one get written through the other's backend registry and everything dies with
   `Unknown dtype undefined`. Forcing a backend was tried (WebGL stalls at ~73%,
   threaded WASM deadlocks at 0%, single-threaded WASM works but slowly) — all of
   it was worse than letting Basic Pitch choose. `transcriptionBackend()` is a
   stub kept only so callers do not need changing.

4. **alphaTab's lazy loading is off.** With it on, only the systems on screen
   get painted, so Print/PDF exports blank staves.

5. **The play-along highlight is ours, not alphaTab's.** alphaTab only moves its
   own cursor while its synthesiser is running, which needs a second
   AudioContext and its own user gesture — it never initialises here, and it
   would be a second clock free to drift. `ScoreView` asks alphaTab where each
   beat sits on the page (`boundsLookup`) and positions the highlight from our
   playback clock.

6. **COOP/COEP on the studio, CORS-clean everywhere.** `/studio` is served with
   `same-origin` and `credentialless` so onnxruntime can use SharedArrayBuffer for
   Demucs; other pages use `same-origin-allow-popups` so the Google sign-in popup
   works. Anything cross-origin the studio fetches must be CORS-clean.

7. **The 6x7 Supabase project is shared by ~18 apps in one `public` schema** —
   88 tables, and already two different functions named `touch_updated_at`.
   Everything riffscribe owns is prefixed `riffscribe_` for that reason; an
   unprefixed `create or replace function touch_updated_at` would have quietly
   taken over another app's trigger.

8. **Opus always decodes at 48 kHz**, whatever rate it was given. The stem cache
   encodes at 44.1 kHz and gets 48 kHz back, so `decodeTrack` resamples to the
   rate the studio wants; skip that and everything plays 8.8% long. Also:
   `AudioData.copyTo` returns **one plane per call** — asking for plane 0 and
   slicing it in half yields the left channel followed by silence. Both of these
   pass a test that uses identical audio in each channel, so the check in
   `cache.ts` uses different tones per channel on purpose.

9. **TensorFlow reaches for `window` as a bare global**, so a worker throws
   ReferenceError at import time before any of our code runs. The transcription
   worker points `window` at `globalThis` before Basic Pitch loads. This is what
   had made every previous attempt to get transcription off the page fail.

10. **Basic Pitch's `await` per window is a microtask, not a yield.** Microtasks
   all drain before the browser paints, so awaiting per window does not keep the
   page alive; the main-thread fallback in `runner.ts` posts a real task between
   windows instead. If you ever re-derive its frame arithmetic, note that
   ANNOTATIONS_FPS is `floor(22050/256)` = 86, not 86.13.

11. **The assistant mounts on React's second effect pass, not the first.** The
   widget import is async, so in development the first pass is always torn down
   before it resolves. Guarding with a "have I started?" ref blocks the second
   pass and the assistant then never appears while developing.

12. **The guide is rendered at sounding pitch; the written key never reaches it.**
   "Write it in" changes the notation only. If it also shifted the guide, the
   cello would play in a different key from the backing stems, which is what
   happened until the November 2026 review.

13. **TensorFlow.js is importable in exactly one place:
   `scripts/eval-cello/lib/bp-node.cjs`**, the Node copy of Basic Pitch the
   evaluation harness uses. Nothing under `src/` imports it, and the pitch
   contour code is plain arithmetic on peaks the worker returns for that reason.
