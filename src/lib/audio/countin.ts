/**
 * The four clicks before you start.
 *
 * Nobody can begin playing on the downbeat of a song that starts the instant
 * they press a button, and nobody can punch in a recording without being given
 * the tempo first. This is that: a bar or two of clicks, at the tempo you are
 * actually practising at, ending exactly where the music begins.
 *
 * It runs on its own short-lived AudioContext rather than through the practice
 * engine, because the engine plays pre-rendered buffers of the song and the
 * count-in has to happen before any of that exists.
 */

export interface CountIn {
  /** Resolves when the last click has sounded. Rejects nothing; cancel is silent. */
  done: Promise<void>;
  cancel: () => void;
}

/**
 * @param bpm      tempo of the song as written
 * @param rate     practice speed, so a count-in at 50% is counted at 50%
 * @param beats    beats per bar
 * @param bars     how many bars to count
 */
export function countIn(bpm: number, rate: number, beats: number, bars: number): CountIn {
  const ctx = new AudioContext();
  const spb = 60 / (bpm * rate);
  const total = Math.max(1, Math.round(beats * bars));
  const start = ctx.currentTime + 0.08; // a beat to get the context running
  let cancelled = false;

  for (let i = 0; i < total; i++) {
    const at = start + i * spb;
    // The first beat of each bar is higher, so you can hear where "one" is.
    const downbeat = i % beats === 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = downbeat ? 1600 : 1100;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(downbeat ? 0.5 : 0.3, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.09);
  }

  const endsAt = start + total * spb;
  const done = new Promise<void>((resolve) => {
    const ms = Math.max(0, (endsAt - ctx.currentTime) * 1000);
    const timer = setTimeout(() => {
      void ctx.close().catch(() => {});
      resolve();
    }, ms);
    void (async () => {
      // If the caller cancels we still resolve, so play() is never left hanging.
      const poll = setInterval(() => {
        if (!cancelled) return;
        clearInterval(poll);
        clearTimeout(timer);
        void ctx.close().catch(() => {});
        resolve();
      }, 30);
      setTimeout(() => clearInterval(poll), ms + 200);
    })();
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}

/** How long a count-in will take, so callers can show it. */
export function countInSeconds(bpm: number, rate: number, beats: number, bars: number): number {
  return (60 / (bpm * rate)) * Math.max(1, Math.round(beats * bars));
}
