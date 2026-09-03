# Riffscribe — handoff

Everything described here is committed, pushed to `main`, and live on
**https://riffscribe.6x7.gr**. Working tree is clean.

- Repo: https://github.com/philipposk/riffscribe
- Vercel project: `riffscribe` (scope `filippos-projects-06f05211`)
- Card on https://www.6x7.gr (Creator tools, ♪ glyph) — lives in
  `~/Devoloper Projects/6x7.gr/src/data/projects.ts`

Deploy is **not** wired to git. Ship with `vercel --prod --yes` from the project
directory; `git push` alone changes nothing on the live site.

## What it is

A musician hears a song, wants to learn one part of it, and needs: that part
written down for their instrument, the song without that part to play against,
a way to slow it down, and a way to check themselves. That is the whole product.
Judge new features against that sentence.

Everything runs in the browser. No accounts, no server-side inference, no
uploads. The only server route is the assistant's LLM proxy.

## Layout

```
src/lib/audio/       decode, fft, karaoke split, tempo/key, playback engine,
                     guide synth, recorder, wav
src/lib/transcribe/  basic-pitch runner, quantiser, fretting, voice splitter,
                     alphaTex / MusicXML / MIDI writers
src/lib/workers/     demucs + karaoke workers
src/components/      Studio (the whole app), Mixer, Transport, Waveform,
                     ScoreView, Assistant
src/app/api/pa/…     the assistant's LLM proxy (the only server route)
local/               fetch-server.mjs — optional link fetcher, runs on your Mac
scripts/             copy-assets (runs on install), verify-tex, verify-voices
```

`Studio.tsx` is large and holds all the state. That is deliberate — the pieces
are tightly coupled through playback position — but it is the first thing to
split if it grows again.

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

6. **COOP/COEP are set globally** (`credentialless`) so onnxruntime can use
   SharedArrayBuffer for Demucs. Anything cross-origin the app fetches must be
   CORS-clean.

## Verified

Checked against the live deployment, not just locally:

- Tempo detection: 120.2 BPM on a 120 BPM clip.
- Key detection: E minor on an E-minor riff, C major on a C-major one.
- Transcription: 14 notes from a 14-note clip; notation + tablature engraved
  with correct clefs, fret numbers and bar numbers.
- MusicXML: well-formed, every measure sums to exactly one 4/4 bar, ties present,
  `fifths` correct. MIDI: valid header, right track count.
- Playback: position advances at exactly 0.50× at 50% speed, audio present
  (analyser peak 0.485), loop cycles 4.33→5.95→4.34 for a 4–6s loop, stops at
  the end.
- Guide instrument: soloed, strong energy at exactly the played pitches and
  ~10× less at off-notes.
- Demucs: full 180 MB download, session build and separation to four stems.
- Instant split: vocal down 10–18 dB against the backing.
- Voice splitter: a known two-line passage splits cleanly with no swapping, and
  two lines out of a quartet become violin + cello (not two violins).
- Assistant: "slow it down to 60 percent" moved the real Speed control to 60%
  and reported the actual studio state back.

## Not verified

- Overdub recording end to end — needs a microphone grant, never exercised.
- `local/fetch-server.mjs` — written and syntax-checked, never run, because
  `yt-dlp` is not installed on this machine.
- Anything on a real full-length song. All testing used synthetic clips of
  8–24 seconds.

## Known limitations to be honest about

- **Transcription runs on the main thread and blocks the page.** A worker version
  existed but TensorFlow's browser bundle would not load in it. Roughly 15s for
  an 8s clip on this Mac, so a four-minute song is minutes of frozen UI. This is
  the single biggest thing worth fixing.
- **Demucs is slow** — minutes per song, plus a one-time 180 MB model download.
  There is a Cancel button and a "Trim song to loop" escape hatch.
- **A quartet cannot be extracted from a recording.** Stem separation gives
  vocals / drums / bass / everything-else, and that last stem is every harmony
  instrument at once. "Split into voices" *arranges* one line across players.
  The UI says so; keep it saying so.
- **Link loading currently needs a helper outside the browser.** The page cannot
  fetch YouTube audio itself (cross-origin, signed media URLs). `local/fetch-server.mjs`
  runs it on the user's machine and the link box is hidden unless a health check
  finds it. A server-side version is viable: YouTube blocks datacentre ranges,
  but Tor gets through — measured 2026-09-04, 10/10 exits resolved formats and a
  full download ran at ~600 KiB/s (yt-dlp 2026.08.19; needs `deno` for the JS
  challenge). Treat that as revocable, not permanent.

## Assistant

Embedded page-assistant, vendored as built ESM in `vendor/page-assistant/`
(widget + core, no install-time clone or build). Capabilities call the real
studio functions, so answers come from the app rather than the model.

One server route: `POST /api/pa/v1/llm/complete`. It is **unauthenticated**, so
it is spend-limited instead — fixed small model (`openai/gpt-oss-20b` via
OpenRouter), 700 output tokens, capped context, 60 requests/hour/IP held in
memory. Env: `OPENROUTER_API_KEY` (set in Vercel production), optional
`ASSISTANT_MODEL`. With no key the widget simply does not appear.

If accounts ever arrive, put this route behind a session and relax the caps.

## Next, in the order I would do them

1. **Get transcription off the main thread.** Either make a worker load work
   (import only `tfjs-core` + `tfjs-converter` + a backend rather than the union
   bundle) or chunk the work with yields. Biggest usability win available.
2. **Save projects.** Not the audio — a four-minute song is ~85 MB raw and ×4
   for stems, and hosting other people's music is a liability. Save the *chart*:
   parts, notes, tempo, key, loop markers, fret choices, instrument. A few KB of
   JSON, on the same Vercel + Supabase pattern as `transcriber`.
3. **Practice features that are cheap and wanted:** count-in, a speed trainer
   that steps the tempo up each loop pass, section markers.
4. **Better guide sound**, if it matters — alphaTab ships a 1.3 MB Sonivox
   soundfont in `public/alphatab/soundfont/` and exposes `api.exportAudio()`, so
   the guide could be rendered from real samples instead of the synth in
   `guide.ts`.

Deliberately **not** doing: AI-generated vocals and style transfer. They need a
server, cost money per run, have murky output licensing, and belong to a
different product than "take a recording apart and learn it".
