# Architecture

Riffscribe is a Next.js app (App Router, React 19) that does its audio work in the browser and uses a
small server only for accounts, saved charts, billing and the assistant. This page is the map. For the
reasons behind the awkward parts read the gotchas in `HANDOFF.md`; for the voice-to-cello pipeline in
detail read `docs/voice-to-cello.md`.

## The shape of it

```
                     browser tab (the product)
 ┌───────────────────────────────────────────────────────────────────┐
 │  Studio (src/components/Studio.tsx and src/components/studio/*)   │
 │     │ state: song, stems, parts, mixer, loop, speed, key          │
 │     ├── workers:  stems (Demucs)  karaoke (instant split)         │
 │     │             transcribe (Basic Pitch)  guide (synth)         │
 │     ├── engine.ts: offline-rendered buffers, one shared clock     │
 │     ├── IndexedDB: stems, transcriptions, mixer, last take        │
 │     └── alphaTab: draws the score (no synth, no second clock)     │
 └───────────────┬───────────────────────────────────────────────────┘
                 │ only text and small JSON, never audio
 ┌───────────────▼───────────────────────────────────────────────────┐
 │  Next.js server (Vercel)                                          │
 │    /api/pa/v1/llm/complete  the assistant's model call            │
 │    /api/checkout /api/portal /api/stripe/webhook /api/withdraw    │
 │    /api/account  /api/admin/settings  /api/health                 │
 └───────────────┬───────────────────────────────────────────────────┘
                 │
        Supabase (shared 6x7 project)        Stripe        Anthropic / OpenRouter
```

Nothing sensible runs on the server for the audio. That is a product decision: no upload, no
per-minute cost, nothing to host that is not ours to host.

## Directories

| Path | What lives there |
|---|---|
| `src/app/` | Pages and API routes. Pages: `/` (landing, demo song), `/studio`, `/songs`, `/pricing`, `/account`, `/admin`, `/c/<id>` (a shared chart, readable without an account), `/terms`, `/privacy`; the llms.txt and llm.txt routes, `robots`, `sitemap`, error pages. |
| `src/components/` | `Studio.tsx` holds the studio's state and wiring; `src/components/studio/` holds what was split out of it (load, split, parts, practice, record, player bar, export menu, tools sheet, help overlay, shortcuts). `Mixer`, `Waveform`, `ScoreView`, `Transport`, `Tuner`, the account and sign-in components, the assistant host, `NativeShell`. |
| `src/lib/audio/` | Decode, FFT, the instant split (`karaoke.ts`), the stem client (`stems.ts`), tempo and key, the playback engine (`engine.ts`), the guide synth (`guide.ts`, `guideLine.ts`, `body.ts`, `room.ts`, `envelope.ts`, `prng.ts`, `guideClient.ts`), count-in, recorder, tuner, wav and mp3 writers. |
| `src/lib/transcribe/` | Basic Pitch runner and wrapper, the note clean-up (`cleanup.ts`, `monoline.ts`), the pitch curve (`contour.ts`), register placement (`register.ts`), quantiser, fretting (`tab.ts`), voice splitter (`voices.ts`), spelling, engraver, take marking (`compare.ts`), alphaTex, MusicXML and MIDI writers. |
| `src/lib/store/` | `cache.ts` (stems, transcriptions, mixer and the last take on the device), `charts.ts` and `chartSave.ts` (saved and shared charts), `account.ts`, `lastSong.ts`, `partialSplit.ts`. |
| `src/lib/llm/` | The assistant's model layer: `models.ts` (allowlist, tasks, prices, fallback order), `anthropic.ts`, `openrouter.ts`, `settings.ts`, `complete.ts`. See `docs/admin-and-llm.md`. |
| `src/lib/billing/`, `stripe.ts`, `billingFlow.ts`, `billingLive.ts` | Stripe client, the webhook's pure logic, checkout's customer choice, the public billing switch. See `docs/billing-go-live.md`. |
| `src/lib/supabase/` | Browser client and the server helpers (`caller`, `serviceClient`). |
| `src/lib/workers/` | The four workers. |
| `supabase/` | `supabase/schema.sql`, `supabase/accounts.sql`, `supabase/assistant_chats.sql`, `supabase/migrations/`, and `supabase/README.md` with the apply order. |
| `scripts/` | `verify-*.mjs` checks, `scripts/eval-cello/` (the evaluation harness), `copy-assets.mjs`, `make-demo.mjs`, `secret-scan.mjs`, `run-tests.mjs`. |
| `mobile/` | The Capacitor phone shell. |
| `vendor/page-assistant/` | The assistant widget, vendored as built code. |
| `local/` | `fetch-server.mjs`, the optional link fetcher that runs on a player's own machine. |
| `public/` | Copied model and wasm assets (`public/models/`, `public/ort/`, `public/vendor/`, `public/alphatab/`), the demo clip and icons. Large files here come from `scripts/copy-assets.mjs`, not by hand. |

## Data flow: from a file to a score

1. **Load.** A dropped file is decoded to stereo audio at 44.1 kHz (`decode.ts`). The file's content
   hash is the key for everything remembered about it. Tempo is read from the onset envelope.
2. **Split.** The instant split (centre extraction) or the Demucs AI split, both in workers, give
   stems. Stems are encoded as Opus and kept in IndexedDB; the eight most recent songs within a 600 MB
   budget.
3. **Transcribe.** Basic Pitch runs in a worker over a stem (or the mix) and returns notes and, for a
   single line, the pitch peaks. Notes are cleaned, quantised to the tempo grid, spelled for the key and
   engraved to alphaTex for alphaTab. A part is notes plus an instrument plus how it was made.
4. **Guide.** Each part is rendered offline to a buffer by the guide synth, on the same sample clock as
   the stems.
5. **Play.** `engine.ts` pre-renders any speed or key change offline with Signalsmith Stretch into plain
   buffers and plays them with ordinary buffer sources started at one moment. The score highlight is
   driven from that same clock.
6. **Practise.** Count-in, speed trainer, sections, loop, tuner and drone, overdub recording, and take
   marking (the take is transcribed and lined up against the chart in `compare.ts`).
7. **Keep and share.** The song's mixer and last overdub stay on the device with its stems. A signed-in
   player can save the chart (parts, notes, tempo, key, sections, loop; a few kilobytes of JSON,
   never audio) and share it as `/c/<id>`.

The pitch curve a vocal part carries (`Part.contour`) is device-only: it is stripped before a chart is
saved. A part brought back from the device cache re-derives its target loudness from the stem it came
from.

## The server

- **Auth.** Supabase Auth (Google, or an e-mail link). The server reads the caller's access token and
  makes a client acting as that person (`caller` in `src/lib/supabase/server.ts`); the service role is
  used only for things a browser must not do (billing writes, usage logging, refunds, reading admin
  settings).
- **Database.** One shared Supabase project, `public` schema, shared with about 18 other apps. Every
  Riffscribe object is prefixed `riffscribe_`. Row-level security is on for every table. See
  `supabase/README.md`.
- **Missing-table rule.** The server behaves when a migration has not run yet: a database error on an
  admin, settings, customer or usage object means "not admin", "default settings", "no stored
  customer" or "skip logging". The release can therefore be deployed before or after the SQL, except for
  0004 and 0005, which must come after (see `supabase/README.md`).
- **The assistant route** requires a signed-in caller, spends one request from the monthly allowance
  in the database, caps everything a caller can push, applies a per-IP budget (in memory, so it resets
  when the function recycles) and picks the model from the admin's settings.
- **Billing** is described in `docs/billing-go-live.md`.
- **Headers.** `next.config.ts` sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
  (`credentialless`) on `/studio` so onnxruntime can use shared memory, a weaker opener policy
  elsewhere so Google sign-in can open its popup, `frame-ancestors 'none'`, and a Content Security
  Policy in **report-only** mode that lists everything the app loads today. Enforcing it is not done.
- **Consent.** PostHog is off until the visitor accepts the banner (`ConsentBanner.tsx`); no session
  recording, no autocapture.

## The phone shell

`mobile/` wraps the live site in a Capacitor WebView; the Next server is not bundled. It adds native
Google sign-in return, the share sheet for exports, a microphone permission and background audio. See
`mobile/README.md`. The web app detects the shell at runtime (`src/lib/native.ts`,
`src/components/NativeShell.tsx`, `src/lib/nativeShare.ts`) and loads the Capacitor modules only then.

## Checks that guard this

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, Next's core-web-vitals rules |
| `npm test` | every `scripts/verify-*.mjs`, then the cello eval in CI mode |
| `npm run eval:cello` | the full evaluation harness (`docs/eval-cello.md`) |
| `npm run secret-scan` | looks for API keys in tracked files |
| `npm run build` | the production build (needs placeholder Supabase values) |

CI (`.github/workflows/ci.yml`, job `Tests`) runs typecheck, lint, test, build and the secret scan on
every pull request and every push to `main`; `.github/workflows/health.yml` checks the live site every
six hours and opens an issue when it stops answering; Dependabot (`.github/dependabot.yml`) proposes
updates weekly and is told to leave the audio and ML stack (and Next's major versions) alone.
