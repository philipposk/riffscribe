# Riffscribe

Give it a song. Get sheet music and tablature for your instrument, a backing
track without the part you are learning, a slow-down player that keeps the
pitch, a score that scrolls itself while you play, and a way to record yourself
over the top.

Live at **https://riffscribe.6x7.gr**

Everything runs inside the browser tab. No upload, no account, no server-side
inference, no per-minute pricing — the audio never leaves the machine.

## What it does

| Step | What happens | What powers it |
| --- | --- | --- |
| 1. Load | Drop an mp3/wav/m4a/flac/ogg. Tempo is detected from the onset envelope. | Web Audio + a small FFT |
| 2. Split | **Instant** vocal removal (phase-based centre extraction, ~1s) or **AI** 4-stem split into vocals / drums / bass / other. | [Demucs](https://github.com/facebookresearch/demucs) via [`demucs-web`](https://www.npmjs.com/package/demucs-web) + onnxruntime-web (WebGPU, WASM fallback) |
| 3. Slow down | 25–150% speed with the key untouched, ±12 semitone transpose with the tempo untouched, drag-to-loop, metronome that follows the speed. | [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) in an AudioWorklet |
| 4. Transcribe | Audio → notes → quantised rhythm → standard notation **and** tablature, with the fretting chosen by a dynamic-programming pass so the hand barely moves. The part is also played back as the instrument you picked, as its own mixer row. | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify) on TensorFlow.js, rendered by [alphaTab](https://alphatab.net) |
| 4b. Play along | The score scrolls itself and highlights the beat being played, so you never touch the mouse while practising. | alphaTab's page geometry, driven by our own playback clock |
| 5. Record | Overdub yourself against the backing track. Takes recorded at reduced speed are stretched back to full tempo without pitch damage, and nudged for speaker→mic latency. | MediaRecorder + offline Signalsmith Stretch |

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
string+fret data), **alphaTex**, **printable PDF**, and **wav** — the full mix,
the backing track, any single row of the mixer, or just the looped section.

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
bad split away.

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
# 2. run the schema (table + row-level security)
supabase db execute -f supabase/schema.sql   # or paste it into the SQL editor
# 3. put the project URL and anon key in .env.local — see .env.example
```

Row-level security allows exactly two reads: your own charts, and any chart
whose owner has turned the link on. Ids are v4 uuids and there is no policy that
lets anyone list rows, so an unshared chart cannot be reached or enumerated.

## Practising

- **Count-in** — one or two bars of clicks at the speed you are practising at,
  so you can come in with the music instead of chasing it.
- **Speed trainer** — with a loop running, every clean pass nudges the tempo up
  5% until it reaches your target, then switches itself off.
- **Named sections** — practise "the chorus", not "somewhere around 2:14".
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

It is optional: with no `OPENROUTER_API_KEY` set the widget simply does not
appear and everything else works as before. The proxy route is unauthenticated,
so it is deliberately spend-limited — a fixed small model, a hard token ceiling,
capped context and a per-IP budget.

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

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm install` copies the Basic Pitch model, the
alphaTab music fonts and the onnxruntime wasm binaries into `public/` — see
`scripts/copy-assets.mjs`.

The Demucs model (~180 MB) is fetched from Hugging Face on first AI split and
then lives in the browser's Cache Storage. Point
`NEXT_PUBLIC_DEMUCS_MODEL_URL` somewhere else to self-host it.

## Browser support

- **Chrome / Edge** — best. WebGPU makes the AI split several times faster.
- **Firefox** — works; the split falls back to multi-threaded WASM.
- **Safari** — works, but it does not implement `Cross-Origin-Embedder-Policy:
  credentialless`, so the split runs single-threaded and is slow. Everything
  else (transcription, slow-down, recording) is full speed.

The app sets `COOP: same-origin` and `COEP: credentialless` so
`SharedArrayBuffer` is available for multi-threaded WASM.

## Layout

```
src/lib/audio/      decode, fft, karaoke split, tempo/key, playback engine,
                    guide synth, count-in, recorder
src/lib/transcribe/ basic-pitch runner, quantiser, fretting, voice splitter,
                    engraver, take marking, alphaTex/MusicXML/MIDI writers
src/lib/store/      the on-device cache, and saved charts
src/lib/supabase/   the optional client
src/lib/workers/    demucs stem-separation worker
src/components/     studio UI (mixer, transport, waveform, score, save bar)
supabase/schema.sql the charts table and its row-level security
scripts/verify-*    checks for the tex writer, voice splitter and take marking
```

## Honest limits

Automatic transcription is a strong first draft, not a finished chart. It is
very good on a solo instrument, decent on a clean stem, and messy on a dense
full mix — so split the stems first and transcribe one at a time. Tempo, key,
bar offset and the quantise grid are all editable, and the MusicXML export
exists precisely so the last 10% can be fixed in a real notation editor.

## Licences of the parts

Basic Pitch (Apache-2.0, Spotify) · Demucs (MIT, Meta) · demucs-web (MIT) ·
alphaTab (MPL-2.0) · Signalsmith Stretch (MIT) · onnxruntime-web (MIT).
