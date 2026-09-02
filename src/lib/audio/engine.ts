/**
 * The practice player.
 *
 * Each track (every stem, the click, your own overdub) gets its own Signalsmith
 * Stretch node and its own fader, so you can mute the vocals while the song is
 * playing. Every node is handed the *same* schedule — same absolute output time,
 * same input position, same rate — and the library derives its position purely
 * from that, so the tracks stay locked together instead of drifting apart.
 *
 * (One node carrying all tracks as extra channel pairs would be tidier, but the
 * library's worklet only ever produces audio for one or two output channels;
 * ask for more and it runs silently forever.)
 *
 * Speed and pitch are independent: 50% speed keeps the original key, and you
 * can transpose ±12 semitones without changing the tempo.
 */
import { loadStretch, type StretchNode } from "./stretchLoader";

export interface EngineTrack {
  id: string;
  label: string;
  left: Float32Array;
  right: Float32Array;
}

export interface EngineState {
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  semitones: number;
  loop: [number, number] | null;
}

interface Voice {
  id: string;
  node: StretchNode;
  gain: GainNode;
}

export class PracticeEngine {
  ctx: AudioContext | null = null;
  private tracks: EngineTrack[] = [];
  private voices: Voice[] = [];
  private gains: Record<string, number> = {};
  private building: Promise<boolean> | null = null;
  private duration = 0;
  private sampleRate = 44100;
  private rate = 1;
  private semitones = 0;
  private loop: [number, number] | null = null;
  private playing = false;
  private lastTime = 0;
  private generation = 0;
  onTime?: (t: number) => void;
  onStateChange?: (s: EngineState) => void;

  state(): EngineState {
    return {
      playing: this.playing,
      time: this.lastTime,
      duration: this.duration,
      rate: this.rate,
      semitones: this.semitones,
      loop: this.loop,
    };
  }

  /**
   * Take the audio, but do not touch Web Audio yet.
   *
   * The graph is deliberately built later, on the first Play (see ensureGraph).
   * A Signalsmith Stretch node constructed on a context whose clock has not
   * started — which is every context created before the visitor clicks anything
   * — is wedged for good: it reports a negative position and never emits a
   * sample. Nothing about resuming afterwards revives it.
   */
  async load(tracks: EngineTrack[], sampleRate: number) {
    await this.dispose();
    this.tracks = tracks;
    this.sampleRate = sampleRate;
    this.duration = tracks.length
      ? Math.max(...tracks.map((t) => t.left.length)) / sampleRate
      : 0;
    this.emit();
  }

  private async ensureGraph(): Promise<boolean> {
    if (this.voices.length) return true;
    if (!this.tracks.length) return false;
    if (this.building) return this.building;

    const generation = ++this.generation;
    this.building = (async () => {
      const ctx = new AudioContext({ sampleRate: this.sampleRate, latencyHint: "playback" });
      // Must be running *before* the worklet nodes are created.
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      for (let i = 0; i < 60 && ctx.currentTime <= t0; i++) {
        await new Promise((r) => setTimeout(r, 16));
      }
      if (ctx.state !== "running") {
        await ctx.close().catch(() => {});
        return false;
      }

      const SignalsmithStretch = await loadStretch();
      const len = Math.max(...this.tracks.map((t) => t.left.length));
      const pad = (ch: Float32Array) => {
        if (ch.length === len) return ch;
        const p = new Float32Array(len);
        p.set(ch.subarray(0, Math.min(ch.length, len)));
        return p;
      };

      const voices: Voice[] = [];
      for (const track of this.tracks) {
        const node = await SignalsmithStretch(ctx, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        if (generation !== this.generation) {
          await ctx.close().catch(() => {});
          return false;
        }
        await node.addBuffers([pad(track.left), pad(track.right)]);
        const gain = ctx.createGain();
        gain.gain.value = this.gains[track.id] ?? 1;
        node.connect(gain);
        gain.connect(ctx.destination);
        voices.push({ id: track.id, node, gain });
      }

      this.ctx = ctx;
      this.voices = voices;

      // one node drives the clock; the rest follow the same schedule
      await voices[0].node.setUpdateInterval(0.03, (t: number) => {
        if (this.playing && !this.loop && t >= this.duration - 0.03) {
          this.lastTime = this.duration;
          this.onTime?.(this.duration);
          void this.pause();
          return;
        }
        this.lastTime = Math.max(0, Math.min(t, this.duration));
        this.onTime?.(this.lastTime);
      });
      return true;
    })();

    const ok = await this.building;
    this.building = null;
    return ok;
  }

  private all(fn: (n: StretchNode) => Promise<unknown>) {
    return Promise.all(this.voices.map((v) => fn(v.node)));
  }

  private emit() {
    this.onStateChange?.(this.state());
  }

  private when() {
    return (this.ctx?.currentTime ?? 0) + 0.06;
  }

  private live() {
    return this.voices.length > 0 && this.ctx?.state === "running";
  }

  async play(from?: number) {
    if (!(await this.ensureGraph())) return;
    const input = from ?? this.lastTime;
    const output = this.when();
    await this.all((n) =>
      n.schedule({
        output,
        active: true,
        input,
        rate: this.rate,
        semitones: this.semitones,
        loopStart: this.loop?.[0] ?? 0,
        loopEnd: this.loop?.[1] ?? 0,
      })
    );
    this.playing = true;
    this.emit();
  }

  async pause() {
    if (!this.live()) { this.playing = false; this.emit(); return; }
    const output = this.when();
    await this.all((n) => n.schedule({ output, active: false }));
    this.playing = false;
    this.emit();
  }

  async toggle() {
    return this.playing ? this.pause() : this.play();
  }

  async seek(t: number) {
    this.lastTime = Math.max(0, Math.min(this.duration, t));
    this.onTime?.(this.lastTime);
    if (!this.live()) { this.emit(); return; }
    const output = this.when();
    await this.all((n) =>
      n.schedule({
        output,
        active: this.playing,
        input: this.lastTime,
        rate: this.rate,
        semitones: this.semitones,
        loopStart: this.loop?.[0] ?? 0,
        loopEnd: this.loop?.[1] ?? 0,
      })
    );
    this.emit();
  }

  async setRate(rate: number) {
    this.rate = Math.max(0.15, Math.min(2.5, rate));
    if (this.live()) {
      const output = this.when();
      await this.all((n) => n.schedule({ output, rate: this.rate }));
    }
    this.emit();
  }

  async setSemitones(semitones: number) {
    this.semitones = Math.max(-12, Math.min(12, semitones));
    if (this.live()) {
      const output = this.when();
      await this.all((n) => n.schedule({ output, semitones: this.semitones }));
    }
    this.emit();
  }

  async setLoop(loop: [number, number] | null) {
    this.loop = loop && loop[1] - loop[0] > 0.05 ? loop : null;
    if (this.live()) {
      const output = this.when();
      await this.all((n) =>
        n.schedule({ output, loopStart: this.loop?.[0] ?? 0, loopEnd: this.loop?.[1] ?? 0 })
      );
    }
    this.emit();
  }

  /** Faders work before the graph exists — the value is applied when it is built. */
  setGain(id: string, value: number) {
    this.gains[id] = value;
    const v = this.voices.find((x) => x.id === id);
    if (v && this.ctx) v.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  hasTrack(id: string) {
    return this.tracks.some((t) => t.id === id);
  }

  trackIds() {
    return this.tracks.map((t) => t.id);
  }

  async dispose() {
    this.generation++;
    for (const v of this.voices) {
      try {
        await v.node.stop();
      } catch {
        /* node may already be gone */
      }
      v.node.disconnect();
      v.gain.disconnect();
    }
    this.voices = [];
    this.tracks = [];
    this.building = null;
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.playing = false;
    this.lastTime = 0;
    this.duration = 0;
  }
}

/** Build a click track so the metronome slows down with the music. */
export function makeClickTrack(
  durationSeconds: number,
  sampleRate: number,
  bpm: number,
  offsetSeconds: number,
  beatsPerBar: number
): [Float32Array, Float32Array] {
  const n = Math.ceil(durationSeconds * sampleRate);
  const buf = new Float32Array(n);
  const spb = 60 / bpm;
  let beat = 0;
  for (let t = offsetSeconds; t < durationSeconds; t += spb, beat++) {
    const start = Math.floor(t * sampleRate);
    const accent = beat % beatsPerBar === 0;
    const freq = accent ? 1600 : 1000;
    const len = Math.floor(sampleRate * 0.035);
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.exp(-i / (sampleRate * 0.006));
      buf[start + i] += Math.sin((2 * Math.PI * freq * i) / sampleRate) * env * (accent ? 0.5 : 0.32);
    }
  }
  return [buf, Float32Array.from(buf)];
}
