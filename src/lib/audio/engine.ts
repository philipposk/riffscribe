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
  private voices: Voice[] = [];
  private duration = 0;
  private rate = 1;
  private semitones = 0;
  private loop: [number, number] | null = null;
  private playing = false;
  private lastTime = 0;
  private generation = 0;
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
    const generation = ++this.generation;

    const ctx = new AudioContext({ sampleRate, latencyHint: "playback" });
    this.ctx = ctx;
    const SignalsmithStretch = await loadStretch();

    const len = Math.max(...tracks.map((t) => t.left.length));
    this.duration = len / sampleRate;

    const pad = (ch: Float32Array) => {
      if (ch.length === len) return ch;
      const p = new Float32Array(len);
      p.set(ch.subarray(0, Math.min(ch.length, len)));
      return p;
    };

    for (const track of tracks) {
      const node = await SignalsmithStretch(ctx, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      if (generation !== this.generation) return; // a newer load() overtook us
      await node.addBuffers([pad(track.left), pad(track.right)]);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      node.connect(gain);
      gain.connect(ctx.destination);
      this.voices.push({ id: track.id, node, gain });
    }

    // one node drives the clock; the rest follow the same schedule
    await this.voices[0].node.setUpdateInterval(0.03, (t: number) => {
      if (this.playing && !this.loop && t >= this.duration - 0.03) {
        this.lastTime = this.duration;
        this.onTime?.(this.duration);
        void this.pause();
        return;
      }
      this.lastTime = Math.min(t, this.duration);
      this.onTime?.(this.lastTime);
    });

    await this.all((n) => n.schedule({ active: false, input: 0, rate: this.rate, semitones: this.semitones }));
    this.emit();
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

  async play(from?: number) {
    if (!this.voices.length || !this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
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
    if (!this.voices.length) return;
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
    if (!this.voices.length) return;
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
    this.onTime?.(this.lastTime);
    this.emit();
  }

  async setRate(rate: number) {
    this.rate = Math.max(0.15, Math.min(2.5, rate));
    const output = this.when();
    await this.all((n) => n.schedule({ output, rate: this.rate }));
    this.emit();
  }

  async setSemitones(semitones: number) {
    this.semitones = Math.max(-12, Math.min(12, semitones));
    const output = this.when();
    await this.all((n) => n.schedule({ output, semitones: this.semitones }));
    this.emit();
  }

  async setLoop(loop: [number, number] | null) {
    this.loop = loop && loop[1] - loop[0] > 0.05 ? loop : null;
    const output = this.when();
    await this.all((n) =>
      n.schedule({ output, loopStart: this.loop?.[0] ?? 0, loopEnd: this.loop?.[1] ?? 0 })
    );
    this.emit();
  }

  setGain(id: string, value: number) {
    const v = this.voices.find((x) => x.id === id);
    if (v && this.ctx) v.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  hasTrack(id: string) {
    return this.voices.some((v) => v.id === id);
  }

  trackIds() {
    return this.voices.map((v) => v.id);
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
