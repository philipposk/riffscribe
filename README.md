# Riffscribe

Give it a song. Get sheet music and tablature for your instrument, a backing
track without the part you are learning, a slow-down player that keeps the
pitch, a score that scrolls itself while you play, and a way to record yourself
over the top.

Live at **https://riffscribe.6x7.gr**

Everything heavy runs inside the browser tab. No upload, no server-side inference,
no per-minute pricing — the audio never leaves the machine. The studio itself
needs no account; signing in adds saved songs, the assistant and, once billing is
open, Pro.

## What it does

| Step | What happens | What powers it |
| --- | --- | --- |
| 1. Load | Drop an mp3/wav/m4a/flac/ogg. Tempo is detected from the onset envelope. | Web Audio + a small FFT |
| 2. Split | **Instant** vocal removal (phase-based centre extraction, ~1s) or **AI** 4-stem split into vocals / drums / bass / other. | [Demucs](https://github.com/facebookresearch/demucs) via [`demucs-web`](https://www.npmjs.com/package/demucs-web) + onnxruntime-web (WebGPU, WASM fallback) |
| 3. Slow down | 25–150% speed with the key untouched, ±12 semitone transpose with the tempo untouched, drag-to-loop, metronome that follows the speed. | [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) in an AudioWorklet |
| 4. Transcribe | Audio → notes → quantised rhythm → standard notation **and** tablature, with the fretting chosen by a dynamic-programming pass so the hand barely moves. Runs in a worker, so the page stays usable. Notes can be corrected in place. The part is also played back as the instrument you picked, as its own mixer row. | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify) on TensorFlow.js, rendered by [alphaTab](https://alphatab.net) |
| 4b. Play along | The score scrolls itself and highlights the beat being played, so you never touch the mouse while practising. | alphaTab's page geometry, driven by our own playback clock |
| 5. Record | Overdub yourself against the backing track. Takes recorded at reduced speed are stretched back to full tempo without pitch damage, and nudged for speaker→mic latency. | MediaRecorder + offline Signalsmith Stretch |

**Replace the voice.** One card in the studio takes a song with a singer, splits
the voice from the band, writes the sung line out for a cello (or a viola,
violin, double bass or a wind instrument) and plays it in the singer's place,
gliding and swelling the way the singer did. "Hear the singer" swaps back. How
it works, and how well, is in [`docs/voice-to-cello.md`](docs/voice-to-cello.md).

A song can hold **several parts**. Transcribe the bass from one stem and the
harmony from another and they engrave as one score, a staff each, each with its
own instrument, its own playback row in the mixer, and its own staff in the
MusicXML and MIDI. Any part can also be **split into voices** and handed to a
duo, trio, quartet or quintet.

> On that last one, plainly: stem separation gives vocals, drums, bass and
> *everything else* — and that last stem is every harmony instrument at once.
> Nothing can reach into a stereo recording and hand back the four players of a
> quartet. Splitting **arranges** one line across instruments; it does not
> recover the original musicians.

Exports: **MIDI**, **MusicXML** (opens in MuseScore / Guitar Pro / Dorico, with
string+fret data), **alphaTex**, **printable PDF**, and **wav** or **mp3** — the
full mix, the backing track, any single row of the mixer, or just the looped
section, at the speed and key you are practising in.

## Instruments

Guitar (6 and 7 string), bass (4 and 5 string), ukulele, mandolin, banjo, piano
and voice; violin, viola, violoncello and double bass; flute, clarinet, alto and
tenor sax, trumpet and trombone. Fretted instruments get tablature as well as
notation, and every instrument gets guide playback in a voice that suits it —
bowed sustain, plucked decay, struck decay, breath, reed or brass.

## What it remembers

Separating a song takes minutes and transcribing it blocks the page, so neither
is thrown away any more. Stems and transcriptions are kept in IndexedDB, keyed
by a hash of the file's contents — drop the same song in again, renamed or
moved, and its stems come straight back. They are stored as Opus, roughly 12 MB
for the four stems of a four-minute song rather than 340 MB of raw samples. The
eight most recent songs are kept, within a 600 MB budget, and one link throws a
bad split away. The mixer settings and the last overdub take are kept with the
song too.

## Saving and sharing

Optional, and off unless a Supabase project is configured.

Signing in (Google, or a link by email) lets you keep a **chart**: the parts,
the notes, the tempo and key you settled on, the sections you named, the loop
you keep coming back to. A few kilobytes of JSON.

The audio is deliberately not part of it. A four-minute song is ~85 MB of
samples and four times that again as stems; uploading it would be slower than
re-splitting it locally, would cost real money to store, and would mean hosting
recordings that are not ours to host. So stems stay on the machine that made
them and only the writing travels.

That is what makes the sharing worth having: an arranger sends one link and each
player opens the same parts, tempo and markings against their own copy of the
song. A shared chart opens at `/c/<id>` — readable and printable without an
account, and openable in the studio.

```bash
# 1. create a Supabase project
# 2. run the SQL in the order given in supabase/README.md (schema.sql first)
# 3. put the project URL and anon key in .env.local — see .env.example
```

Row-level security lets you read and change only your own charts. A shared
chart is read one at a time, by its id, through the database function
`riffscribe_shared_chart`; ids are v4 uuids and there is no policy that lets
anyone list rows, so an unshared chart cannot be reached or enumerated.

## Practising

- **Count-in** — one or two bars of clicks at the speed you are practising at,
  so you can come in with the music instead of chasing it.
- **Speed trainer** — with a loop running, every clean pass nudges the tempo up
  5% until it reaches your target, then switches itself off.
- **Named sections** — practise "the chorus", not "somewhere around 2:14".
- **Tuner and drone** — a needle for tuning up, and a sustained tone to play
  against. The drone is set to the key of whatever you loaded. A note a few
  cents out beats audibly against a drone long before it looks wrong on a
  meter, which is why it is worth more than the needle for intonation.
- **Choose the key** — pick the key the part should be written in and the notes
  and the key signature move together. Transposing instruments are handled: a
  B flat clarinet or trumpet part comes out a tone above concert pitch, an
  E flat alto sax a major sixth above, as those players expect to read.
- **Notes spelled for the key** — E flat in a flat key, D sharp in a sharp one.
  Spelling is chosen on the line of fifths rather than always defaulting to
  sharps, which is what made flat keys read wrongly before.
- **Fix what the model misheard** — click a note on the top staff and move it by
  a semitone or an octave, or take it out. Transcription is a first draft, and
  until now the only way to correct it was to export to MuseScore and not come
  back.
- **How did I do?** — records are marked against the written part: what was
  clean, what was missed, what sat out of tune or out of time, whether you rush
  or drag, and which bars are weakest, with one press to loop those and go
  again. It works by transcribing your take and lining it up with the chart, so
  it inherits the same blind spots as the transcription — a surprising result is
  a question, not a verdict.
- The transport stays pinned to the bottom of the window, because someone
  holding an instrument cannot go hunting up a long score for the play button.

## The assistant

An embedded [page-assistant](https://github.com/philipposk/page-assistant) can
drive the studio: split the stems, write the part out for an instrument, set the
tempo or the grid, change the practice speed and key, loop a section, work the
mixer, export files. Every action is a registered capability that calls the same
function the button does, so what it tells you comes from the app rather than
from the model, and anything slow or irreversible asks first. Voice uses the
browser's own speech APIs and costs nothing.

It is optional: with neither `ANTHROPIC_API_KEY` nor `OPENROUTER_API_KEY` set
the widget simply does not appear and everything else works as before. The proxy
route requires a signed-in caller and spends one request from the plan's monthly
quota, and it is also spend-limited — a hard token ceiling, capped context and a
per-IP budget. The model is chosen on the server from a short allowlist (Claude
Haiku 5.5 by default, with OpenRouter as the fallback) by an admin on `/admin`;
see [`docs/admin-and-llm.md`](docs/admin-and-llm.md).

### Its chat history

Signed in, your chats with the assistant are saved to your account, so they are
there on any device you sign in on. Signed out, or on a deployment without
Supabase, they stay in this browser. The assistant's settings (Data tab) switch
between *Save to my account*, *Save on this device* and *Don't save*, offer to
move chats already in this browser to your account, and have *Delete all my
chats*; a single chat is deleted from the sidebar.

What is saved is the text of the conversation — its title, messages and model —
in `riffscribe_assistant_chats`, in the same Supabase project as charts. Never
audio. Row-level security lets each person read and change only their own chats.
Saved chats with no activity for 12 months are deleted automatically.

The SQL for this, and for everything else in the database, is applied in the
order given in [`supabase/README.md`](supabase/README.md). Enable pg_cron first
(Database → Extensions) and the retention jobs schedule themselves.

## Accounts, plans and billing

Free allows 10 saved songs and 100 assistant requests a month; Pro (€5 / month)
allows 1000 and 2000. Transcription and stem splitting run on your device and
are never metered. `supabase/accounts.sql` holds the usage table, the limits and
the functions behind the account menu; the numbered files in `supabase/migrations/`
add to it (apply order in [`supabase/README.md`](supabase/README.md)). Stripe
checkout, the billing portal, the webhook and the 14-day withdrawal are
`/api/checkout`, `/api/portal`, `/api/stripe/webhook` and `/api/withdraw`; the
pages are `/pricing`, `/songs` (saved songs), `/account` and, for admins,
`/admin`. Pro is not for sale yet: it shows "Coming soon" until billing is
switched on, following [`docs/billing-go-live.md`](docs/billing-go-live.md).
Details and the deploy notes are in `HANDOFF.md`.

## Loading from a link

There is an optional helper that fetches audio from a URL:

```bash
npm run fetch-server     # needs: brew install yt-dlp ffmpeg
```

While it is running, the studio shows a "paste a link" box; otherwise the box is
hidden and you use the file picker.

A web page cannot pull audio off YouTube by itself — it is cross-origin and the
media URLs are signed — so the fetching has to happen outside the browser. The
helper is the simplest place to put it, and it means the audio never touches
anyone else's computer.

A shared server can do the same job. YouTube blocks datacentre address ranges
hard, but routing through **Tor** currently gets past that: measured 2026-09-04,
ten separate Tor exits all resolved formats and a full audio download ran at
~600 KiB/s. That is a policy, not a guarantee — the exit list is public and
YouTube can block it whenever it likes — so anything built on it needs a
fallback. Bulk media over Tor also spends volunteer-donated relay bandwidth,
which is fine for a few songs and not fine for an open public service.

Downloading from YouTube is against their terms of service whoever does it.
Fine for your own practice material; not something to put on a public front
page.

## How voice to cello works

Basic Pitch finds the notes in the vocal stem; a clean-up joins the pieces a
vibrato breaks them into and keeps one note at a time; the singer's real pitch
curve and loudness are followed through that line; the line is moved by octaves
to where the instrument sings; and a source-and-filter bowed model (a sawtooth
through cello-body resonances, with a small room) plays it as one slurred line
that follows the curve. The score shows the notes, the sound follows the singer.
Stage by stage, with the measured numbers and what is not solved:
[`docs/voice-to-cello.md`](docs/voice-to-cello.md).

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm install` copies the Basic Pitch model, the
alphaTab music fonts and the onnxruntime wasm binaries into `public/` — see
`scripts/copy-assets.mjs`. Copy `.env.example` to .env.local for anything
beyond the studio itself.

The Demucs model (~180 MB) is fetched from Hugging Face on first AI split and
then lives in the browser's Cache Storage. Point
`NEXT_PUBLIC_DEMUCS_MODEL_URL` somewhere else to self-host it.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop, build (copies the assets first), serve the build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Every `scripts/verify-*.mjs`, then the cello eval in CI mode |
| `npm run eval:cello` | The evaluation harness for the voice-to-cello path, [`docs/eval-cello.md`](docs/eval-cello.md). Add `-- --update-baseline` to bless new numbers |
| `npm run secret-scan` | Looks for API keys in files git tracks |
| `npm run fetch-server` | The optional link fetcher (below) |

The build wants placeholder Supabase values when there are none:
`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build`.
CI runs typecheck, lint, test, build and the secret scan on every pull request.

### Environment variables

Every one is optional; with none set the studio works on its own.
`NEXT_PUBLIC_` variables are published to every visitor and read when the site
is built; the rest are server-only. The full commented list is `.env.example`.

| Variable | What it switches on |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The site's public address, for e-mail links, Stripe return URLs and the sitemap |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Accounts, saved and shared charts |
| `SUPABASE_SERVICE_ROLE_KEY` | Server writes: usage, subscriptions, admin settings, refunds |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | The assistant (Claude first, OpenRouter as the fallback) |
| `RIFFSCRIBE_ADMIN_BOOTSTRAP` | The first admin's user id; admin while set, so delete it once an admin row exists |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET` | Billing |
| `NEXT_PUBLIC_BILLING_ENABLED` | Opens Pro checkout (otherwise "Coming soon") |
| `STRIPE_TAX_ENABLED`, `STRIPE_TOS_CONSENT`, `STRIPE_AUTO_REFUND_EFW`, `STRIPE_SELF_SERVE_WITHDRAWAL` | Checkout behaviour in live mode; each off unless `true` |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics, after the visitor consents |
| `NEXT_PUBLIC_FETCH_URL` | Where the studio looks for the link fetcher |
| `NEXT_PUBLIC_DEMUCS_MODEL_URL` | A self-hosted Demucs model |
| `RIFFSCRIBE_EVAL_DATA` | Folder of downloaded evaluation recordings for the cello eval; never commit them |

## Mobile app

`mobile/` is a Capacitor shell. It does not bundle this Next server. The
WebView loads **https://riffscribe.6x7.gr** (`server.url`, cleartext off).
Setup, the microphone and background-audio keys, the Google return scheme, and
store-listing notes are in [`mobile/README.md`](mobile/README.md). A draft
listing is [`mobile/STORE.md`](mobile/STORE.md).

On a phone, Google sign-in opens the system browser and returns through
`gr.sixseven.riffscribe://auth/callback`. That exact URL has to be on the Supabase
redirect allow-list before the shell can finish sign-in. Email sign-in links
are unchanged. AI stem split can fail on a phone; instant vocal removal is not
blocked. Exports in the shell go to the share sheet.

The shell only picks up the native sign-in, share sheet, and stem-split
messages after this web app is deployed. Until then it still shows the live site.

## Browser support

- **Chrome / Edge** — best. WebGPU makes the AI split several times faster.
- **Firefox** — works; the split falls back to multi-threaded WASM.
- **Safari** — works, but it does not implement `Cross-Origin-Embedder-Policy:
  credentialless`, so the split runs single-threaded and is slow. Everything
  else (transcription, slow-down, recording) is full speed.

The studio (`/studio`) is served with `COOP: same-origin` and `COEP:
credentialless` so `SharedArrayBuffer` is available for multi-threaded WASM.
Every other page uses `COOP: same-origin-allow-popups`, which keeps the Google
sign-in popup working; links into the studio are full page loads for that reason.

## Layout

```
src/lib/audio/      decode, fft, karaoke split, tempo/key, playback engine,
                    guide synth (bowed line, body, room), count-in, recorder,
                    wav and mp3 writers
src/lib/transcribe/ basic-pitch runner, note clean-up, single-line clean-up,
                    pitch contour, register placement, quantiser, fretting,
                    voice splitter, engraver, take marking, alphaTex/MusicXML/
                    MIDI writers
src/lib/store/      the on-device cache, and saved charts
src/lib/llm/        the assistant's model layer: allowlist, Claude, OpenRouter
src/lib/billing/    the Stripe webhook's logic
src/lib/supabase/   the optional client and the server helpers
src/lib/workers/    stems (Demucs), karaoke, transcribe and guide workers
src/components/     Studio and, in studio/, its panels; mixer, transport,
                    waveform, score, account and admin components
src/app/            pages: /, /studio, /songs, /pricing, /account, /admin,
                    /c/<id>, /terms, /privacy; api/checkout, api/portal,
                    api/stripe/webhook, api/withdraw, api/account,
                    api/admin/settings, api/health, api/pa (the assistant proxy)
supabase/           schema.sql, accounts.sql, assistant_chats.sql, migrations/
                    and README.md with the order to apply them in
mobile/             the Capacitor phone shell
docs/               architecture, voice to cello, the eval harness, billing
                    go-live, admin and models
scripts/            verify-* checks (`npm test` runs them all) and eval-cello/
```

Start with [`docs/architecture.md`](docs/architecture.md).

## Honest limits

Automatic transcription is a strong first draft, not a finished chart. It is
very good on a solo instrument, decent on a clean stem, and messy on a dense
full mix — so split the stems first and transcribe one at a time. Tempo, key,
bar offset and the quantise grid are all editable, individual notes can be
corrected by clicking them, and the MusicXML export exists so anything left can
be finished in a real notation editor.

The same goes for replacing a voice. The Quick split (centre extraction) is a
preview: on real mixes it separates a vocal only slightly better than leaving
the mix alone, and the Clean (AI) split is the one to use when it matters. The
cello is a synthesised model, not a recording of one, and nobody has yet
judged by ear how it sounds on a full song. The measurements are in
[`docs/voice-to-cello.md`](docs/voice-to-cello.md).

## Licences of the parts

Basic Pitch (Apache-2.0, Spotify) · Demucs (code MIT, Meta; its trained weights
are research-only, see the notice) · demucs-web (MIT) · alphaTab (MPL-2.0) ·
Signalsmith Stretch (MIT) · onnxruntime-web (MIT). The full list, with versions
and the open licence questions, is in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
