/**
 * The practice player.
 *
 * Everything (all stems, the click, your own overdub) is fed into ONE
 * Signalsmith Stretch node as separate channel pairs. That matters: a single
 * stretch engine means every track slows down, speeds up and loops in perfect
 * sample-lock — no drift between the backing track and what you recorded.
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

export class PracticeEngine {
  ctx: AudioContext | null = null;
  private node: StretchNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private gains = new Map<string, GainNode>();
  private order: string[] = [];
  private duration = 0;
  private rate = 1;
  private semitones = 0;
  private loop: [number, number] | null = null;
  private playing = false;
  private lastTime = 0;
  onTime?: (t: number) => void;
  onStateChange?: (s: EngineState) => void;

  get sampleRate() {
    return this.ctx?.sampleRate ?? 44100;
  }

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

  async load(tracks: EngineTrack[], sampleRate: number) {
    await this.dispose();
    if (!tracks.length) return;

    const ctx = new AudioContext({ sampleRate, latencyHint: "playback" });
    this.ctx = ctx;
    const channels = tracks.length * 2;

    const SignalsmithStretch = await loadStretch();
    const node = await SignalsmithStretch(ctx, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
    });
    this.node = node;

    const len = Math.max(...tracks.map((t) => t.left.length));
    const padded: Float32Array[] = [];
    for (const t of tracks) {
      for (const ch of [t.left, t.right]) {
        if (ch.length === len) padded.push(ch);
        else {
          const p = new Float32Array(len);
          p.set(ch.subarray(0, Math.min(ch.length, len)));
          padded.push(p);
        }
      }
    }
    await node.addBuffers(padded);

    this.duration = len / sampleRate;
    this.order = tracks.map((t) => t.id);

    const splitter = ctx.createChannelSplitter(channels);
    node.connect(splitter);
    this.splitter = splitter;

    tracks.forEach((t, i) => {
      const merger = ctx.createChannelMerger(2);
      splitter.connect(merger, i * 2, 0);
      splitter.connect(merger, i * 2 + 1, 1);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      merger.connect(gain);
      gain.connect(ctx.destination);
      this.gains.set(t.id, gain);
    });

    await node.setUpdateInterval(0.03, (t: number) => {
      // the stretch node happily reads past the end of the buffer — stop there
      if (this.playing && !this.loop && t >= this.duration - 0.03) {
        this.lastTime = this.duration;
        this.onTime?.(this.duration);
        void this.pause();
        return;
      }
      this.lastTime = Math.min(t, this.duration);
      this.onTime?.(this.lastTime);
    });
    await node.schedule({ active: false, input: 0, rate: this.rate, semitones: this.semitones });
    this.emit();
  }

  private emit() {
    this.onStateChange?.(this.state());
  }

  private when() {
    return (this.ctx?.currentTime ?? 0) + 0.06;
  }

  async play(from?: number) {
    if (!this.node || !this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const input = from ?? this.lastTime;
    await this.node.schedule({
      output: this.when(),
      active: true,
      input,
      rate: this.rate,
      semitones: this.semitones,
      loopStart: this.loop?.[0] ?? 0,
      loopEnd: this.loop?.[1] ?? 0,
    });
    this.playing = true;
    this.emit();
  }

  async pause() {
    if (!this.node) return;
    await this.node.schedule({ output: this.when(), active: false });
    this.playing = false;
    this.emit();
  }

  async toggle() {
    return this.playing ? this.pause() : this.play();
  }

  async seek(t: number) {
    this.lastTime = Math.max(0, Math.min(this.duration, t));
    if (!this.node) return;
    await this.node.schedule({
      output: this.when(),
      active: this.playing,
      input: this.lastTime,
      rate: this.rate,
      semitones: this.semitones,
      loopStart: this.loop?.[0] ?? 0,
      loopEnd: this.loop?.[1] ?? 0,
    });
    this.onTime?.(this.lastTime);
    this.emit();
  }

  async setRate(rate: number) {
    this.rate = Math.max(0.15, Math.min(2.5, rate));
    await this.node?.schedule({ output: this.when(), rate: this.rate });
    this.emit();
  }

  async setSemitones(semitones: number) {
    this.semitones = Math.max(-12, Math.min(12, semitones));
    await this.node?.schedule({ output: this.when(), semitones: this.semitones });
    this.emit();
  }

  async setLoop(loop: [number, number] | null) {
    this.loop = loop && loop[1] - loop[0] > 0.05 ? loop : null;
    await this.node?.schedule({
      output: this.when(),
      loopStart: this.loop?.[0] ?? 0,
      loopEnd: this.loop?.[1] ?? 0,
    });
    this.emit();
  }

  setGain(id: string, value: number) {
    const g = this.gains.get(id);
    if (g && this.ctx) g.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  hasTrack(id: string) {
    return this.gains.has(id);
  }

  trackIds() {
    return [...this.order];
  }

  async dispose() {
    try {
      await this.node?.stop();
    } catch {
      /* node may already be gone */
    }
    this.node?.disconnect();
    this.splitter?.disconnect();
    this.gains.forEach((g) => g.disconnect());
    this.gains.clear();
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.node = null;
    this.splitter = null;
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
