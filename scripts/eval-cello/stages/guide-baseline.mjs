/**
 * How the guide instrument behaves today, measured with an independent pitch tracker (YIN).
 * One 4 s held A3 on the bowed timbre; see how far the heard pitch strays from 220 Hz in each
 * second, whether two renders come out identical, and how long a four-minute part takes.
 */
import { yin } from "../lib/yin.mjs";
import { sha256Float32, centsBetween, percentile } from "../lib/metrics.mjs";

const SR = 44100;
const A3 = 220;

export const name = "guide-baseline";

export async function run() {
  const { synthesizeGuide } = await import("../../../src/lib/audio/guide.ts");
  const note = { pitchMidi: 57, startTimeSeconds: 0, durationSeconds: 4, amplitude: 0.8, pitchBends: [] };
  const render = () => synthesizeGuide([note], { timbre: "bowed", sampleRate: SR, lengthSamples: Math.floor(4.5 * SR) })[0];

  const first = render();
  const second = render();
  const track = yin(first, SR);
  const winSeconds = 2048 / SR;

  const metrics = {};
  for (let w = 0; w < 4; w++) {
    let worst = 0, seen = 0;
    for (let f = 0; f < track.frames; f++) {
      const t = f * track.hop;
      if (t < w || t + winSeconds > w + 1 || !track.voiced[f]) continue;
      seen++;
      worst = Math.max(worst, Math.abs(centsBetween(track.hz[f], A3)));
    }
    // nothing readable in the window counts as the worst case, not as a pass
    metrics[`maxCents_${w}_${w + 1}s`] = { value: seen ? round(worst, 1) : 1200, better: "lower", tol: 3 };
  }
  metrics.deterministic = { value: sha256Float32(first) === sha256Float32(second) ? 1 : 0, better: "higher", tol: 0 };

  // 598 notes of 0.35 s spread over 240 s: the length of a long song's part
  const notes = Array.from({ length: 598 }, (_, i) => ({
    pitchMidi: 48 + (i % 24),
    startTimeSeconds: (i * (240 - 0.35)) / 597,
    durationSeconds: 0.35,
    amplitude: 0.7,
    pitchBends: [],
  }));
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    synthesizeGuide(notes, { timbre: "bowed", sampleRate: SR, lengthSamples: 240 * SR });
    times.push(performance.now() - t0);
  }
  // wall-clock time differs between machines, so it is recorded but never compared
  metrics.renderMs4min = { value: Math.round(percentile(times, 50)), better: "lower", tol: 0, info: true };

  return { metrics, gates: [] };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
