# Riffscribe — handoff

Written 2026-11-19 on the release branch `review/full-app-2026-11`, before its one pull request to
`main`. What is live on **https://riffscribe.6x7.gr** is whatever `main` last deployed; this branch
adds the November 2026 review fixes, the voice-to-cello work, the launch-readiness work (legal pages,
billing hardening, admin, CI) and the UX pass. Read "Not verified" before trusting any of it in
production.

- Repo: https://github.com/philipposk/riffscribe
- Vercel project: `riffscribe` (scope `filippos-projects-06f05211`)
- Card on https://www.6x7.gr (Creator tools, ♪ glyph) — lives in
  `~/Devoloper Projects/6x7.gr/src/data/projects.ts`

Deploy **is** wired to git: the Vercel project is linked to GitHub, every push to `main` deploys
production, and other branches get preview deploys. Work on a branch and merge through a pull request
whose `Tests` check is green. (`vercel --prod --yes` still deploys by hand.) The Vercel Hobby deploy
cap (100 a day) is shared by the whole account, and the account was paused for CPU on 30 October, so
push a branch once when it is ready, not after every commit.

## What it is

A musician hears a song, wants to learn one part of it, and needs: that part written down for their
instrument, the song without that part to play against, a way to slow it down, and a way to check
themselves. That is the whole product. Judge new features against that sentence. "Replace the voice
with a cello" is the same sentence applied to a singer.

Everything heavy runs in the browser. No server-side inference, no uploads. Accounts are optional
(Supabase) and only needed to save songs, use the assistant and, later, pay for Pro — see
"Accounts, plans, billing" below.

## Layout

The map with the reasons is `docs/architecture.md`. The short version:

```
src/app/             pages (/, /studio, /songs, /pricing, /account, /admin, /c/<id>,
                     /terms, /privacy) and api/ (checkout, portal, stripe/webhook,
                     withdraw, account, admin/settings, health, pa/v1/llm/complete)
src/components/      Studio.tsx (the state and wiring) and studio/ (what was split out of
                     it: load, split, parts, practice, record, player bar, export menu,
                     tools sheet, help overlay, shortcuts); Mixer, Waveform, ScoreView,
                     Transport, Tuner, account and admin components, NativeShell
src/lib/audio/       decode, fft, karaoke (instant split), stems (client), engine
                     (playback), guide + guideLine + body + room + envelope (the guide
                     synth), recorder, tuner, wav + mp3
src/lib/transcribe/  basicPitch + runner, cleanup, monoline, contour, register, quantize,
                     tab, voices, spelling, engrave, compare (take marking), alphatex,
                     musicxml, midi
src/lib/store/       cache.ts (stems, transcriptions, mixer, last take on the device),
                     charts.ts + chartSave.ts (saved and shared charts)
src/lib/llm/         models (allowlist), anthropic, openrouter, settings, complete
src/lib/billing/     the Stripe webhook's pure logic
src/lib/workers/     stems, karaoke, transcribe, guide
supabase/            schema.sql, accounts.sql, assistant_chats.sql, migrations/, README.md
mobile/              the Capacitor phone shell
docs/                architecture, voice-to-cello, eval-cello, billing-go-live,
                     admin-and-llm
scripts/             verify-*.mjs (23 of them; `npm test`), eval-cello/ (the harness),
                     copy-assets, make-demo, secret-scan
local/               fetch-server.mjs — optional link fetcher, runs on your Mac
.github/workflows/   ci.yml (the `Tests` check), health.yml (live-site check)
```

`Studio.tsx` still holds the state. That is deliberate — the pieces are tightly coupled through
playback position — but its size is the first thing to look at if it grows again; the split into
`src/components/studio/` was pure moves and makes the next one cheaper.

## Hard-won gotchas — read before touching audio

Each of these cost real debugging time and each will come straight back if the code is "cleaned up"
past them. They are binding: `AGENTS.md` repeats the ones that bite hardest.

1. **Signalsmith Stretch must not go through the bundler.** It builds its AudioWorklet by calling
   `Function.prototype.toString()` on its own WASM loader; any bundler renames the closure and the
   worklet silently never becomes ready — every call hangs with no error. It is copied to
   `public/vendor/` by `scripts/copy-assets.mjs` and imported at runtime with
   `/* turbopackIgnore: true */` (`src/lib/audio/stretchLoader.ts`).

2. **The realtime stretch worklet is not used, on purpose.** Depending on when and how the
   AudioContext was created it comes up producing silence and never advancing, and once wedged it
   reports a negative position forever. Reproduced with one node, with several, and with the
   library's own `start()`. The same library renders *offline* perfectly, so `engine.ts` pre-renders
   speed/pitch changes into plain AudioBuffers and plays them with ordinary buffer sources. 100%
   speed with no transpose skips rendering entirely.

3. **Do not import TensorFlow.js anywhere.** Basic Pitch carries its own copy and makes its tensors
   through it. A second instance means tensors created by one get written through the other's
   backend registry and everything dies with `Unknown dtype undefined`. Forcing a backend was tried
   (WebGL stalls at ~73%, threaded WASM deadlocks at 0%, single-threaded WASM works but slowly) — all
   of it was worse than letting Basic Pitch choose. `transcriptionBackend()` is a stub kept only so
   callers do not need changing.

4. **alphaTab's lazy loading is off.** With it on, only the systems on screen get painted, so
   Print/PDF exports blank staves.

5. **The play-along highlight is ours, not alphaTab's.** alphaTab only moves its own cursor while its
   synthesiser is running, which needs a second AudioContext and its own user gesture — it never
   initialises here, and it would be a second clock free to drift. `ScoreView` asks alphaTab where
   each beat sits on the page (`boundsLookup`) and positions the highlight from our playback clock.

6. **COOP/COEP on the studio, CORS-clean everywhere.** `/studio` is served with
   `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` so
   onnxruntime can use SharedArrayBuffer for Demucs (`next.config.ts`). Every other page uses
   `same-origin-allow-popups`, which keeps the Google sign-in popup working. Anything cross-origin the
   studio fetches must be CORS-clean, and no new cross-origin fetch should be added casually.

7. **The 6x7 Supabase project is shared by ~18 apps in one `public` schema** — 88 tables, and
   already two different functions named `touch_updated_at`. Everything riffscribe owns is prefixed
   `riffscribe_` for that reason; an unprefixed `create or replace function touch_updated_at` would
   have quietly taken over another app's trigger.

8. **Opus always decodes at 48 kHz**, whatever rate it was given. The stem cache encodes at 44.1 kHz
   and gets 48 kHz back, so `decodeTrack` resamples to the rate the studio wants; skip that and
   everything plays 8.8% long. Also: `AudioData.copyTo` returns **one plane per call** — asking for
   plane 0 and slicing it in half yields the left channel followed by silence. Both of these pass a
   test that uses identical audio in each channel, so the check in `cache.ts` uses different tones
   per channel on purpose.

9. **TensorFlow reaches for `window` as a bare global**, so a worker throws ReferenceError at import
   time before any of our code runs. The transcription worker points `window` at `globalThis` before
   Basic Pitch loads. This is what had made every previous attempt to get transcription off the page
   fail.

10. **Basic Pitch's `await` per window is a microtask, not a yield.** Microtasks all drain before the
    browser paints, so awaiting per window does not keep the page alive; the main-thread fallback in
    `runner.ts` posts a real task between windows instead. If you ever re-derive its frame
    arithmetic, note that ANNOTATIONS_FPS is `floor(22050/256)` = 86, not 86.13.

11. **The assistant mounts on React's second effect pass, not the first.** The widget import is
    async, so in development the first pass is always torn down before it resolves. Guarding with a
    "have I started?" ref blocks the second pass and the assistant then never appears while
    developing. Leave the `lendStudio` effect and the `AssistantHost` mounting exactly as they are.

12. **The guide is rendered at sounding pitch; the written key never reaches it.** "Write it in"
    changes the notation (the key signature and the written notes) and nothing else. Until the
    November 2026 review it also shifted the guide, so the cello played in a different key from the
    backing stems. The guide synth takes no transpose from the studio; if a feature seems to need
    one, the feature is wrong.

13. **TensorFlow.js is importable in exactly one place: `scripts/eval-cello/lib/bp-node.cjs`.** That
    is the Node copy of Basic Pitch the evaluation harness uses. Nothing under `src/` may import
    `@tensorflow/tfjs`, and the harness must not re-derive the model's frame arithmetic. The pitch
    curve code (`src/lib/transcribe/contour.ts`) is plain arithmetic on peaks the worker hands back for
    that reason.

## What it does now, beyond transcribing

- **Replace the voice.** One card after the Load panel: pick an instrument (cello by default), then
  Quick (instant split) or Clean (AI split). The vocal stem is transcribed over the voice's own range,
  cleaned to one line, given a pitch curve and a loudness curve, moved to the instrument's octave, and
  played as a continuous bowed line in the singer's place. "Hear the singer" flips both mutes. See
  `docs/voice-to-cello.md` for the pipeline and the numbers.
- **Nothing is recomputed twice.** Stems and transcriptions live in IndexedDB, keyed by a hash of the
  file's contents, stored as Opus (~12 MB for a four-minute song's four stems rather than 340 MB).
  Eight songs, 600 MB budget, least-recently-opened evicted first. The mixer and the last overdub take
  are kept with the song.
- **Practice tools**: count-in, a speed trainer that steps the tempo up on each clean loop pass, named
  sections, a loop, keyboard shortcuts (`?` lists them) and one player bar pinned to the bottom.
- **Take marking**: the recording is transcribed and lined up against the chart to report clean /
  missed / out of tune / out of time, rush-or-drag, and the weakest bars, which can be looped in one
  press.
- **Charts save and share** through Supabase, if configured. Only the writing travels; audio never
  leaves the machine.
- **Notes can be corrected in place** — click one on the top staff, move it by a semitone or an
  octave, or delete it, with an undo stack.
- **Tuner and drone**, the drone set to the key of the loaded song, in a Tools sheet.
- **Exports**: MIDI, MusicXML, alphaTex, PDF (print), wav and mp3, at the speed and key being
  practised. In the phone shell they go to the share sheet.
- **A demo song** (`/studio?demo=1`, "Try the demo song" on the landing page), generated by
  `scripts/make-demo.mjs`, CC0.

### Recovered work (commit 7323c7f)

This work was found uncommitted in the local `main` checkout on 2026-11-19 and rebased onto the
branch. It is in, and it is the least exercised part of the release:

- **The Capacitor phone shell** in `mobile/`. It wraps the live site in a WebView (`server.url` is
  production, the Next server is not bundled) and adds native Google sign-in return, a share sheet for
  exports, a microphone permission and background audio. `mobile/README.md` is the setup guide and
  `mobile/STORE.md` a draft store listing; no store upload has happened and no screenshots were
  invented. The web side is `src/lib/native.ts`, `src/lib/nativeShare.ts` and
  `src/components/NativeShell.tsx`, which load Capacitor only when the bridge is present. The shell
  only picks up its new behaviour once this release is deployed.
- **The Supabase redirect allow-list must contain `gr.sixseven.riffscribe://auth/callback`**
  (Dashboard, Authentication, URL configuration, Redirect URLs), next to
  `https://riffscribe.6x7.gr/studio`. Without it Google sign-in in the shell returns an error instead
  of a code. Nobody has added it yet.
- **MP3 export** (`src/lib/audio/mp3.ts`, 128 kbps through `lamejs`, which is LGPL-3.0 — see
  `THIRD_PARTY_NOTICES.md`), and exports rendered at the practice speed and key.
- **Mixer and overdub kept per song** (`src/lib/store/cache.ts`, `getSession` and `putSession`).

## Verified

### Before this release, against the live deployment

Checked on the deployed site, not just locally. All with synthetic clips of 4 to 24 seconds.

- Tempo detection: 120.2 BPM on a 120 BPM clip. Key detection: E minor on an E-minor riff, C major
  on a C-major one.
- Transcription: 14 notes from a 14-note clip; notation and tablature engraved with correct clefs,
  fret numbers and bar numbers. In a worker: 24 of 24 notes from a 12-second clip in 1.7 s.
- MusicXML well-formed, every measure sums to one 4/4 bar, ties present, `fifths` correct. MIDI valid.
- Playback: position advances at exactly 0.50x at 50% speed, audio present (analyser peak 0.485), loop
  cycles and stops at the end.
- Demucs: full 180 MB download, session build and separation to four stems. Instant split: vocal down
  10 to 18 dB against the backing on a synthetic mix (on real songs it is much weaker; see below).
- Stem cache: a restored backing track matches a freshly separated one to within 0.2% RMS on both
  channels, against a file with a different tone in each channel.
- Count-in 2.22 s against 2.17 s expected; speed trainer 50% to 75% and off; sections; note editing;
  the tuner against a synthetic microphone (A4 twenty cents sharp read as +20c); recording and take
  marking with a synthetic microphone and two injected faults, reported correctly.
- Row-level security against the live table as owner and as anonymous: owner CRUD works; an unshared
  chart is invisible to anonymous; an anonymous edit changes nothing. A refused edit answers **204**,
  not an error — PostgREST reports 204 when a policy matches zero rows, so check the value.

### By script, on the release branch (2026-11-19, in Node, no browser)

- `npm test`: the 23 verify scripts and the cello eval in CI mode pass. They cover the writers
  (tex, MusicXML), spelling, the tuner, take marking, the voice splitter, the engine and DSP maths, the
  guide, the mono-line clean-up, the Stripe webhook logic, plans, the SQL files (statically), the LLM
  adapter, the assistant route's caps, account data, chat history, studio state and UX helpers, the
  recorder, song search, the stem cache and the site config.
- The full cello eval with the real data (`npm run eval:cello` with `RIFFSCRIBE_EVAL_DATA` set) passes
  every gate and matches every baseline. The numbers are in `docs/voice-to-cello.md`; the ones to
  remember: real singing note F1 0.50 raw and 0.54 cleaned; instant split on real songs gives a vocal
  SDR of only 0.05 dB on average; the continuous guide stays within 3.4 cents (median) and 10.9 cents
  (95th percentile) of the singer on the synthetic line.

## Not verified

No browser has exercised any of the following. The scripts above test logic in Node; they cannot tell
you that a screen works, that something is audible, or that a live service accepts a request.

- **"Replace the voice" end to end on a real song in a browser**, Quick or Clean. The Clean (Demucs)
  path has never been scored by the harness. Nobody has *listened* to the cello on a real song:
  pitch, timing and loudness are measured, whether it sounds like a cello is not.
- **The wave-gate smoke** (13 items, listed in the release plan: studio loads isolated, demo plays,
  50% speed, transcription in a worker, the replace flow, solo guide, written key not moving the
  guide, shortcuts, assistant above the player bar, player bar at 390 px, tools sheet and export menu,
  error banner, print preview) has not been run against a preview URL.
- **The new UI**: player bar and its speed/key popover, the help overlay, the Tools sheet, the AI
  split confirmation, the skip link and landmarks, the consent banner (PostHog should stay off until
  accepted), the landing page and `/studio?demo=1`, the legal pages, error pages, 44 px touch targets,
  keyboard navigation and contrast after the accessibility pass. At phone width nothing has been
  looked at.
- **The Claude assistant against the real API**, and `/admin`. The adapter is tested against
  stand-ins; no Anthropic key has been used. The prompt-cache saving, the fallback, the cost column
  and what a round really costs are unmeasured.
- **Migrations 0003 to 0007 against the live project.** They are checked statically
  (`scripts/verify-sql.mjs`) and not run. `supabase/assistant_chats.sql`: whether it has been applied
  is **unknown until checked in the Supabase dashboard**. An earlier version of this file said both
  that it had and that it had not; do not trust either. The chat-history code is checked against a
  stand-in client only.
- **Live-mode billing.** Nothing has been bought against a live key. The nine-event webhook, the
  portal, the self-serve withdrawal, tax and the consent box are checked only by unit tests and test
  mode.
- **The phone shell.** `mobile/` has never been built in Xcode or Android Studio; native Google
  sign-in, the share sheet and the microphone permission are unexercised. MP3 export in a browser and
  in the shell is unexercised.
- **Overdub recording end to end** with a real microphone grant, and the take marking behind it (the
  marking logic is unit-tested).
- **`local/fetch-server.mjs`** — written and syntax-checked, never run, because `yt-dlp` is not
  installed on the machine that wrote it.
- **A real song start to finish, an iPad on a music stand, and Safari.** Everything that was
  checked in a browser used clips of seconds.
- **The Content Security Policy** is report-only and nobody reads the reports (there is no collector).

## Known limitations to be honest about

- **Demucs is slow** — minutes per song, plus a one-time 180 MB model download. There is a Cancel
  button and a "Trim song to loop" escape hatch. Its weights are research-only: see the licence note in
  "Open items that need you".
- **The Quick split is a preview.** On real mixes (MUSDB18-7s, 50 clips) it scores a mean vocal SDR of
  0.05 dB against -5.2 dB for leaving the mix alone; it pulls centred bass and snare into the vocal and
  leaves reverb and doubles in the backing. The Clean split is the one to use.
- **The cello is a model, not a recording.** The soundfont that ships with alphaTab looked like a way
  to get real cello samples and is not (see "Next", 1). The guide is a source-and-filter synth: a
  band-limited sawtooth through fixed body resonances. It is in tune and it follows the singer; it does
  not sound like a recorded cello.
- **Transcription is a first draft.** On real singing about half the notes still do not match a human
  annotator's. Note onsets after a slide come about 60 ms late in the raw output.
- **A quartet cannot be extracted from a recording.** Stem separation gives vocals / drums / bass /
  everything-else, and that last stem is every harmony instrument at once. "Split into voices"
  *arranges* one line across players. The UI says so; keep it saying so.
- **Link loading currently needs a helper outside the browser.** The page cannot fetch YouTube audio
  itself (cross-origin, signed media URLs). `local/fetch-server.mjs` runs it on the user's machine and
  the link box is hidden unless a health check finds it. A server-side version is viable: YouTube
  blocks datacentre ranges, but Tor gets through — measured 2026-09-04, 10/10 exits resolved formats
  and a full download ran at ~600 KiB/s (yt-dlp 2026.08.19; needs `deno` for the JS challenge). Treat
  that as revocable, not permanent. Downloading from YouTube is against their terms whoever does it.
- **`scripts/eval-cello/stages/roundtrip-score.mjs` marks truth onsets at the start of the glide**, not
  its midpoint like the other stages, so its reported lateness (~35 ms) is an artefact and its F1 is
  pessimistic. Aligning it with `scripts/eval-cello/lib/fixtures.mjs` is the next eval chore; its
  baseline will move when it is done.

## Assistant

Embedded page-assistant (0.7.2), vendored as built ESM in `vendor/page-assistant/` (widget and core,
no install-time clone or build). Capabilities call the real studio functions, so answers come from the
app rather than the model.

It is mounted above the pages (`AssistantHost`, rendered by `Providers`) on `/studio` and `/songs`, so
a link in a reply changes page through the router without closing the chat. The studio lends its
controls through `src/lib/assistantBridge.ts`; its capabilities (`src/components/studio/assistantActions.ts`)
are `enabled` only while it is open. `find_saved_songs` answers with links: each song to
`/studio?song=<id>`, and past five, "…and N more" to `/songs?q=<words>` — the same search as the My
songs box, both through `matchSongs` in `src/lib/songSearch.ts`.

Server route: `POST /api/pa/v1/llm/complete`. Requires a signed-in caller (the access token arrives as
the `rs_at` cookie, since the widget sets its own headers) and spends one request from the plan via
`riffscribe_use_assistant`. Spend guards stay: a hard output ceiling, capped context, 60
requests/hour/IP in memory. The model is chosen on the server: Claude Haiku 5.5 by default, switchable
by an admin on `/admin` between Haiku, Sonnet and Opus 5.5 and gpt-oss-20b (OpenRouter), with
gpt-oss-20b as the fallback when Claude is unavailable. Everything about that — admin setup, the cost
table, the fallback rules, how to add a model — is in `docs/admin-and-llm.md`. Env: `ANTHROPIC_API_KEY`,
`OPENROUTER_API_KEY`, `RIFFSCRIBE_ADMIN_BOOTSTRAP`. `ASSISTANT_MODEL` no longer exists. The widget
mounts only for signed-in users — its own 401/429 messages ("not configured", "busy") would mislead.

## Accounts, plans, billing

- **SQL and its order** are in `supabase/README.md`. The base files `schema.sql`, `accounts.sql` and
  `assistant_chats.sql` come first (`accounts.sql` was applied to `fmrnqepyyjucnfbrqawl`;
  `assistant_chats.sql` — check, see "Not verified"). Then the numbered migrations in
  `supabase/migrations/`:

  | File | What it does | When |
  |---|---|---|
  | `0003_review_fixes.sql` | `riffscribe_shared_chart` (read a shared chart by id), request refund, deleting your data keeps this month's usage, plan grace period, chart size limits | any time after `accounts.sql` |
  | `0004_drop_shared_chart_listing.sql` | removes the policy that let anyone list shared charts | **after the release is deployed** |
  | `0005_hardening.sql` | policies `to authenticated`, anon closed out of the tables, fixed `search_path` on functions, song-cap lock, retention jobs | **after the release is deployed**, after 0004 |
  | `0006_billing.sql` | `riffscribe_customers` (one Stripe customer per person per mode), `past_due` keeps Pro | any time after 0004 |
  | `0007_admin.sql` | `riffscribe_admins`, `riffscribe_settings`, `riffscribe_llm_usage`, `riffscribe_is_admin()`, `riffscribe_log_llm()` | any time after 0004 |

  Why 0004 and 0005 wait: until the release that reads shared charts through `riffscribe_shared_chart`
  is live, the running app reads them straight from the table, and 0004 and 0005 remove that access.
  Applied early, every shared link stops opening for signed-out visitors. Treat all five (0003 to
  0007) as not applied until the dashboard says otherwise: the previous handoff said 0003 had not
  been applied, and nothing since has run any of them. Never edit a migration that has run; add
  a new numbered file. The app works with any prefix of the list applied.
- Limits live in `riffscribe_limits` and are mirrored for display in `src/lib/plans.ts` — keep in
  step. Free: 10 saved songs, 100 assistant requests a month. Pro EUR 5 a month: 1000 / 2000.
  Transcription and the rest run on the player's device and are never metered.
- UI: account menu (`src/components/AccountMenu.tsx`) in the studio header and `SiteHeader`;
  `/songs`, `/account`, `/pricing`, `/terms`, `/privacy`.
- **Stripe** is on the shared 6x7 account in test mode. Going live is a sequence with an order and
  four new flags (all off): `docs/billing-go-live.md`. In short: deploy, apply the SQL, Dashboard, env,
  smoke purchase, then `NEXT_PUBLIC_BILLING_ENABLED=true`. Test-mode rows in the shared `subscriptions`
  table must be ended first; the SQL is in that page.
- Deleting data (`/api/account`) removes Riffscribe rows and cancels the Stripe subscription; the
  shared 6x7 login is kept.
- Analytics: PostHog (`src/components/Providers.tsx`), no recording or autocapture, off until the
  visitor accepts the consent banner. Env `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` — currently the same
  project as transcriber; give Riffscribe its own before launch.

Chat history (`src/lib/assistantHistory.ts`): signed in, chats go to the player's account in
`riffscribe_assistant_chats` through the widget's Supabase adapter and the browser client — RLS,
every policy `auth.uid() = user_id`. Signed out, or with no Supabase configured, they stay in
localStorage, kept per signed-in person so a shared browser does not mix players. The player can pick
account / this device / don't save in the widget's Data tab. Sign-in and sign-out call
`PageAssistant.refreshChatHistory()`. Chats idle 12 months are deleted daily by the pg_cron job
`riffscribe-assistant-chats-retention` — only scheduled if pg_cron was enabled when
`supabase/assistant_chats.sql` was run; otherwise run the `cron.schedule` at the end of that file by
hand.

## Ops

- **CI** (`.github/workflows/ci.yml`, check name `Tests`): on every pull request and every push to
  `main` — `npm ci`, typecheck, lint, `npm test`, the production build with placeholder Supabase
  values, a secret scan of the tree and, on pull requests, of every commit in the range. Each step
  reports on its own. Third-party actions are pinned by commit.
- **Health check** (`.github/workflows/health.yml`): every six hours GitHub requests `/`, `/studio` and
  `/api/health` on the live site. A failure opens (or updates) one issue labelled `ops-alert`; a good
  run closes it. `/api/health` reports only whether the Supabase, assistant and billing variables are
  set, never their values.
- **Dependabot** (`.github/dependabot.yml`): weekly npm updates, with the audio and ML stack
  (`@tensorflow/tfjs`, `@spotify/basic-pitch`, `signalsmith-stretch`, `onnxruntime-web`, `demucs-web`,
  `@coderline/alphatab`) and Next's majors ignored, because those need hand-testing.
- **Local checks before saying a task is done:** `npm run typecheck`, `npm run lint`, `npm test`, and
  the build with placeholder Supabase values. `npm run eval:cello` when you touch the voice path.
- **Not monitored, on purpose or by omission:** Stripe webhook failures (watch the Dashboard's
  webhook page), Supabase errors and quota, the Vercel CPU and deploy caps, spend on the model
  providers (the `/admin` page shows the estimate; set a limit in the Anthropic console), the CSP
  report-only violations, browser errors (no error tracker is installed; PostHog does not capture
  exceptions), and backups (nothing scripted beyond Supabase's own). A silent failure in any of these
  is found by a person, not by the repo.
- **The main risk when merging:** the release is one large pull request; CodeRabbit skips pull
  requests over 150 files, so run a local `/code-review` on the diff instead of splitting it.

## Eval data (local only)

The cello eval's real-data stages read `RIFFSCRIBE_EVAL_DATA`, currently
`~/riffscribe-eval/data` on the maintainer's Mac: `vocadito/` (CC BY 4.0) and `musdb7/` (MUSDB18-7s,
**non-commercial, never commit it or copy it into the repo**). ffmpeg decodes the MUSDB clips
(`/opt/homebrew/bin/ffmpeg`; stream order mixture, drums, bass, other, vocals). Both stages are slow
and skip cleanly when the variable is unset, which is what CI does. Only aggregate numbers go into
`scripts/eval-cello/baselines/`. To re-download, follow `docs/eval-cello.md`.

## Prior art and Chimera: what was decided

Research behind the release plan (nothing was installed or cloned; star counts and licences as of
2026-11-19):

- **Separation.** The Demucs weights used by `demucs-web` come from a third-party Hugging Face repo
  with no licence, and Demucs' author says the weights are research-only. A MIT-weights separator
  exists (SCNet: 13 MB for the standard model, 45 MB for the large; its own README quotes vocals SDR of
  9.9 and 11.0 against htdemucs' 8.9). The large model is about 8 times slower than real time on
  browser WASM, so only the standard one is realistic without WebGPU. Both were trained on MUSDB18-HQ
  (educational use), so a MIT label on the weights does not settle the training data. Decision: no
  change in this release; the question goes to the user (below).
- **Vocal pitch.** SwiftF0 (MIT, a 135 KB ONNX model) would give a cleaner vocal curve than Basic Pitch's
  peaks. Deferred: add it only if the `contour` and `pipeline` eval stages show Basic Pitch's curve is
  the limit on real stems. Basic Pitch on onnxruntime instead of TensorFlow.js (the same weights, a
  230 KB model) would remove gotchas 3, 9 and 10; deferred as a 3 to 5 day change that needs browser
  verification. Do not use `pitchfinder` (GPL-3.0), `essentia.js` (AGPL-3.0), or anything that needs
  TensorFlow.js.
- **Voice to instrument.** No ready-made vocal-to-cello model runs in a browser (DDSP needs
  TensorFlow.js; RAVE is non-commercial; MIDI-DDSP is archived). The route taken is the in-house one:
  a pitch curve driving a synthesised bowed line.
- **Sampled cello.** Closed for now. The Sonivox soundfont is not a sampled cello (see "Next", 1).
  Candidates when it is reopened: University of Iowa solo cello (informal licence, needs written
  confirmation) or CC0 VSCO-2 (a cello *section* only). Do not use GPL-licensed soundfont players or
  CC BY-SA sample sets.
- **Chimera** (`jamesondh/chimera-vocal-synth`, MIT) is a physical-model voice that *sings* notes. It
  does not turn a recording into an instrument, its own measured word error rate on English lyrics is
  about 49 to 54%, it has no Greek and no lyric source exists in Riffscribe. Decision: borrow the
  **scoring method** and the **MusicXML note extractor** (both are in the eval harness and credited in
  `THIRD_PARTY_NOTICES.md`); defer a "sing it on la" guide as an opt-in experiment; do not integrate
  the engine, its AudioWorklet or its Rust build, and do not market "sings your lyrics".
- **Similar apps.** Nothing open, browser-only and similar exists. Oh-Sheet (server, piano, contradictory
  licence), NeuralNote (a desktop plugin), Session Craft (closed) were reference only.

## Open items that need you

| Item | Blocks |
|---|---|
| Company legal name, CVR, address and VAT id for `src/lib/company.ts`; which inbox is the contact (`admin@6x7.gr` assumed); a lawyer's review of the terms and privacy pages | Publishing the final legal pages; Stripe activation |
| Apply `supabase/migrations/0003_review_fixes.sql` to `supabase/migrations/0007_admin.sql` to `fmrnqepyyjucnfbrqawl` in the order in `supabase/README.md`, **0004 and 0005 only after the release deploys**; confirm in the dashboard whether `assistant_chats.sql` and pg_cron are applied; seed `riffscribe_admins` | The shared-chart fix, the admin page, the customer mapping |
| Add `gr.sixseven.riffscribe://auth/callback` to the Supabase redirect allow-list | Google sign-in in the phone shell |
| Check row-level security on the shared `subscriptions` and `app_access` tables (not in this repo) | A browser-writable row there is a free Pro plan |
| Stripe: which legal entity owns the shared 6x7 account; activation; live price; the webhook endpoint with the nine events and the pinned API version; portal; public-details URLs; e-mails; a restricted live key; delete the test-mode rows; one real purchase and refund | Going live (`docs/billing-go-live.md`) |
| Decisions, all default off: Stripe Tax (needs VAT registration and OSS — ask the accountant) → `STRIPE_TAX_ENABLED`; the terms-consent box → `STRIPE_TOS_CONSENT`; auto-refund on fraud warnings → `STRIPE_AUTO_REFUND_EFW`; the self-serve withdrawal button → `STRIPE_SELF_SERVE_WITHDRAWAL` | Checkout behaviour in live mode |
| Vercel: Pro plan before commercial use; scope the Stripe and service-role secrets to Production only; add `ANTHROPIC_API_KEY` and `NEXT_PUBLIC_SITE_URL`, optionally `RIFFSCRIBE_ADMIN_BOOTSTRAP`; delete `ASSISTANT_MODEL` | Live billing; the Claude assistant |
| Confirm the assistant's default model (Haiku 5.5 chosen for cost) and set a spend limit in the Anthropic console | Cost exposure |
| GitHub: a ruleset on `main` requiring a pull request and the `Tests` check; enable Dependabot alerts | Deploy safety |
| PostHog: its own project and key for Riffscribe, and a retention period | Privacy page accuracy |
| **Demucs weights:** keep, mirror, or move to an MIT-weights separator (SCNet). A lawyer should decide, not the maintainers | Legal exposure once Pro is sold |
| **`lamejs` is LGPL-3.0** and is bundled for MP3 export: accept the notice in `THIRD_PARTY_NOTICES.md`, load it as a swappable script, or drop MP3 | Legal exposure once Pro is sold |
| Cello samples: accept the Iowa solo cello (informal statement, ask for it in writing) or CC0 only (a section, not a solo) | A real sampled timbre |
| Whether anything embeds Riffscribe in an iframe | Today `frame-ancestors 'none'` is enforced, so nothing may |
| Listen to the cello on a real song with a real vocal and say whether it is good enough to sell | The headline feature |

## Next, in the order I would do them

1. **The sound.** Nobody has judged the guide by ear on a real song. Do that first, with a real vocal and
   the Clean split. If it is the weak spot, the options in order of cost: tune the bow, body and room
   parameters in `src/lib/audio/guideLine.ts` and `body.ts` against what you hear (the `guide-line` eval
   stage keeps the pitch and level honest while you do); then real samples once the licence is settled.
   **Do not look to the bundled soundfont for cello samples.** `public/alphatab/soundfont/sonivox.sf2`'s
   cello (General MIDI preset 42) is six single-cycle wavetables, 12 to 35 ms long with 13 to 87-sample
   loops, at 16 to 22 kHz. It was parsed in November 2026; the earlier plan to render the guide from
   those "real samples" was wrong and is dropped.
2. **Run the wave-gate smoke on a preview** (the list is in "Not verified"), then listen and look.
3. **Apply the SQL and the redirect-list entry** (see "Open items that need you"), in order.
4. **A real song, start to finish,** on a laptop and then an iPad.
5. **Rhythm editing.** Pitch can be corrected in place, but a note landing in the wrong bar still needs
   MuseScore. Dragging a note's onset, or nudging the bar offset per part, would close that.
6. **Better vocals in, better cello out.** A separator with commercial-use weights, SwiftF0 for the
   curve, and removing the "ghost singer" from the backing track are each a few days and each needs
   browser checks and licence checks (see "Prior art").

Deliberately **not** doing: AI-generated vocals and style transfer. They need a server, cost money per
run, have murky output licensing, and belong to a different product than "take a recording apart and
learn it". Also deferred, with reasons in the research notes: per-phrase octave placement and clef
changes, a guided stepper layout and a stand view, enforcing the CSP, exception capture, a backup
script, and the next major of `stripe` (do it after go-live, as its own pull request).
