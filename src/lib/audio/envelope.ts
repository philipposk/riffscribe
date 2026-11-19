/**
 * How loud a recording is from moment to moment, on the same 100-per-second grid as a pitch
 * contour. Used to make the guide swell and fade with the singer it replaces.
 */

/**
 * Loudness per frame: RMS over a 20 ms Hann window centred on each frame time (frame j sits at
 * j / fps seconds), then smoothed by a follower that rises in about 30 ms and falls in about
 * 150 ms, so a consonant or a breath does not read as a new phrase. Rounded to 0.001.
 */
export function loudnessCurve(mono: Float32Array, sampleRate: number, fps = 100): number[] {
  const frames = Math.ceil((mono.length * fps) / sampleRate);
  const win = Math.max(2, Math.round(0.02 * sampleRate));
  const half = win / 2;
  const w = new Float64Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / win);

  const attack = Math.exp(-1 / (0.03 * fps));
  const release = Math.exp(-1 / (0.15 * fps));
  const out = new Array<number>(frames);
  let y = 0;
  for (let j = 0; j < frames; j++) {
    const start = Math.round((j * sampleRate) / fps - half);
    let acc = 0, norm = 0;
    for (let i = 0; i < win; i++) {
      const s = start + i;
      norm += w[i];
      if (s < 0 || s >= mono.length) continue;
      acc += w[i] * mono[s] * mono[s];
    }
    const x = Math.sqrt(acc / norm);
    const a = x > y ? attack : release;
    y = a * y + (1 - a) * x;
    out[j] = Math.round(y * 1000) / 1000;
  }
  return out;
}
