# Riffscribe

Give it a song. Get sheet music, guitar tab, a backing track without the vocals, a
slow-down player that keeps the pitch, and a way to record yourself over the top.

Live at **https://riff.6x7.gr**

Everything runs inside the browser tab. No upload, no account, no server-side
inference, no per-minute pricing — the audio never leaves the machine.

## What it does

| Step | What happens | What powers it |
| --- | --- | --- |
| 1. Load | Drop an mp3/wav/m4a/flac/ogg. Tempo is detected from the onset envelope. | Web Audio + a small FFT |
| 2. Split | **Instant** vocal removal (phase-based centre extraction, ~1s) or **AI** 4-stem split into vocals / drums / bass / other. | [Demucs](https://github.com/facebookresearch/demucs) via [`demucs-web`](https://www.npmjs.com/package/demucs-web) + onnxruntime-web (WebGPU, WASM fallback) |
| 3. Slow down | 25–150% speed with the key untouched, ±12 semitone transpose with the tempo untouched, drag-to-loop, metronome that follows the speed. | [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) in an AudioWorklet |
| 4. Transcribe | Audio → notes → quantised rhythm → standard notation **and** tablature, with the fretting chosen by a dynamic-programming pass so the hand barely moves. | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify) on TensorFlow.js, rendered by [alphaTab](https://alphatab.net) |
| 5. Record | Overdub yourself against the backing track. Takes recorded at reduced speed are stretched back to full tempo without pitch damage, and nudged for speaker→mic latency. | MediaRecorder + offline Signalsmith Stretch |

Exports: **MIDI**, **MusicXML** (opens in MuseScore / Guitar Pro / Dorico, with
string+fret data), **alphaTex**, **printable PDF**, and **wav** for the backing
track or the full mix including your take.

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
src/lib/audio/      decode, fft, karaoke split, tempo/key, playback engine, recorder
src/lib/transcribe/ basic-pitch runner, quantiser, fretting, alphaTex/MusicXML/MIDI writers
src/lib/workers/    demucs stem-separation worker
src/components/     studio UI (mixer, transport, waveform, score)
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
