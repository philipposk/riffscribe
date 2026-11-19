/**
 * YIN pitch tracker (de Cheveigne and Kawahara, 2002), used as an independent ruler for what a
 * synthesised note really sounds like. Window 2048 samples at 44.1 kHz (scaled for other rates),
 * hop 10 ms, absolute threshold 0.15, parabolic refinement of the lag.
 */
export function yin(audio, sr, { hopSeconds = 0.01, threshold = 0.15, minHz = 60, maxHz = 1000 } = {}) {
  let win = Math.round((2048 * sr) / 44100);
  win += win % 2;
  const half = win / 2;
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(half - 1, Math.ceil(sr / minHz));
  const hop = Math.max(1, Math.round(hopSeconds * sr));
  const frames = Math.max(0, Math.floor((audio.length - win) / hop) + 1);
  const hz = new Float32Array(frames);
  const voiced = new Uint8Array(frames);
  const d = new Float64Array(tauMax + 2);
  const cmnd = new Float64Array(tauMax + 2);

  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    // difference function
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let acc = 0;
      for (let i = 0; i < half; i++) {
        const diff = audio[s + i] - audio[s + i + tau];
        acc += diff * diff;
      }
      d[tau] = acc;
    }
    // cumulative mean normalised difference
    cmnd[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      run += d[tau];
      cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    // first dip under the threshold, followed down to its local minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) continue; // unvoiced
    // parabolic refinement
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
    hz[f] = sr / (tau + Math.max(-1, Math.min(1, shift)));
    voiced[f] = 1;
  }
  return { hz, voiced, hop: hopSeconds, frames };
}
