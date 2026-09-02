/**
 * The practice player.
 *
 * Speed and pitch changes are rendered *offline* — each track is time-stretched
 * ahead of time into a plain AudioBuffer — and playback is then ordinary
 * AudioBufferSourceNodes started at one shared moment. Every track therefore
 * stays locked to every other, and the transport is as reliable as any audio
 * player.
 *
 * The obvious alternative, running the stretcher live in an AudioWorklet, was
 * tried first and abandoned: its worklet frequently comes up producing silence
 * and never advancing, depending on how and when the context was created. The
 * same library renders offline perfectly, so that is what we use.
 *
 * At 100% speed and no transpose nothing is rendered at all — the original
 * audio is played as-is, so pressing play is instant.
 */
import { loadStretch } from "./stretchLoader";

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
  /** 0..1 while re-rendering after a speed or pitch change, else null. */
  rendering: number | null;
}

interface Voice {
  id: string;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

const key = (rate: number, semitones: number) => `${rate.toFixed(3)}|${semitones}`;

export class PracticeEngine {
  ctx: AudioContext | null = null;
  private tracks: EngineTrack[] = [];
  private voices = new Map<string, Voice>();
  private gains: Record<string, number> = {};
  /** rendered audio per (rate, semitones), one buffer per track id */
  private cache = new Map<string, Map<string, AudioBuffer>>();
  private renderJob: Promise<Map<string, AudioBuffer>> | null = null;
  private renderKey = "";
  private sampleRate = 44100;
  private duration = 0;
  private rate = 1;
  private semitones = 0;
  private loop: [number, number] | null = null;
  private playing = false;
  private rendering: number | null = null;
  /** song-time position where the current run started, and when it started */
  private anchorSong = 0;
  private anchorCtx = 0;
  private ticker: number | null = null;
  private generation = 0;

  onTime?: (t: number) => void;
  onStateChange?: (s: EngineState) => void;

  state(): EngineState {
    return {
      playing: this.playing,
      time: this.position(),
      duration: this.duration,
      rate: this.rate,
      semitones: this.semitones,
      loop: this.loop,
      rendering: this.rendering,
    };
  }

  /** Current position in song time (seconds of the original recording). */
  private position() {
    if (!this.playing || !this.ctx) return this.anchorSong;
    const elapsed = (this.ctx.currentTime - this.anchorCtx) * this.rate;
    let t = this.anchorSong + elapsed;
    if (this.loop) {
      const [a, b] = this.loop;
      const span = b - a;
      if (span > 0 && t > b) t = a + ((t - a) % span);
    }
    return Math.max(0, Math.min(this.duration, t));
  }

  async load(tracks: EngineTrack[], sampleRate: number) {
    await this.dispose();
    this.tracks = tracks;
    this.sampleRate = sampleRate;
    this.duration = tracks.length
      ? Math.max(...tracks.map((t) => t.left.length)) / sampleRate
      : 0;
    this.emit();
  }

  private emit() {
    this.onStateChange?.(this.state());
  }

  /** The realtime context is created on the first Play, inside the click. */
  private async context() {
    if (this.ctx) {
      if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const ctx = new AudioContext({ sampleRate: this.sampleRate });
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    this.ctx = ctx;
    for (const track of this.tracks) {
      const gain = ctx.createGain();
      gain.gain.value = this.gains[track.id] ?? 1;
      gain.connect(ctx.destination);
      this.voices.set(track.id, { id: track.id, gain, source: null });
    }
    return ctx;
  }

  private toAudioBuffer(ctx: BaseAudioContext, left: Float32Array, right: Float32Array) {
    const buf = ctx.createBuffer(2, left.length, this.sampleRate);
    buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
    return buf;
  }

  /**
   * Time-stretched audio for the current speed/pitch, rendering it if needed.
   * `rate` follows the Signalsmith convention: output length = input / rate.
   */
  private async buffers(): Promise<Map<string, AudioBuffer>> {
    const ctx = await this.context();
    const k = key(this.rate, this.semitones);
    const hit = this.cache.get(k);
    if (hit) return hit;

    if (this.rate === 1 && this.semitones === 0) {
      const plain = new Map<string, AudioBuffer>();
      for (const t of this.tracks) plain.set(t.id, this.toAudioBuffer(ctx, t.left, t.right));
      this.cache.set(k, plain);
      return plain;
    }

    if (this.renderJob && this.renderKey === k) return this.renderJob;

    this.renderKey = k;
    const generation = this.generation;
    this.renderJob = (async () => {
      const SignalsmithStretch = await loadStretch();
      const out = new Map<string, AudioBuffer>();
      const total = this.tracks.length;
      let done = 0;
      this.rendering = 0;
      this.emit();

      for (const track of this.tracks) {
        const inLength = track.left.length;
        const outLength = Math.ceil(inLength / this.rate) + Math.ceil(this.sampleRate * 0.25);
        const off = new OfflineAudioContext(2, outLength, this.sampleRate);
        const node = await SignalsmithStretch(off, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        await node.addBuffers([Float32Array.from(track.left), Float32Array.from(track.right)]);
        node.connect(off.destination);
        await node.schedule({
          output: 0,
          active: true,
          input: 0,
          rate: this.rate,
          semitones: this.semitones,
        });
        out.set(track.id, await off.startRendering());
        done++;
        this.rendering = done / total;
        this.emit();
      }

      this.rendering = null;
      if (generation === this.generation) this.cache.set(k, out);
      this.emit();
      return out;
    })();

    try {
      return await this.renderJob;
    } finally {
      this.renderJob = null;
    }
  }

  private stopSources() {
    for (const v of this.voices.values()) {
      if (!v.source) continue;
      try {
        v.source.stop();
      } catch {
        /* already stopped */
      }
      v.source.disconnect();
      v.source = null;
    }
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  async play(from?: number) {
    if (!this.tracks.length) return;
    const generation = ++this.generation;
    const startSong = Math.max(0, Math.min(this.duration, from ?? this.anchorSong));
    const ctx = await this.context();
    const buffers = await this.buffers();
    if (generation !== this.generation) return; // superseded while rendering

    this.stopSources();
    const when = ctx.currentTime + 0.08;
    // rendered audio runs at 1/rate of song time
    const offset = startSong / this.rate;
    const loop = this.loop;

    for (const [id, buffer] of buffers) {
      const voice = this.voices.get(id);
      if (!voice) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (loop) {
        src.loop = true;
        src.loopStart = loop[0] / this.rate;
        src.loopEnd = loop[1] / this.rate;
      }
      src.connect(voice.gain);
      src.start(when, offset);
      voice.source = src;
    }

    this.anchorSong = startSong;
    this.anchorCtx = when;
    this.playing = true;

    this.ticker = window.setInterval(() => {
      const t = this.position();
      this.onTime?.(t);
      if (!this.loop && t >= this.duration - 0.02) void this.pause(this.duration);
    }, 60);

    this.emit();
  }

  async pause(at?: number) {
    const t = at ?? this.position();
    this.stopSources();
    this.anchorSong = Math.max(0, Math.min(this.duration, t));
    this.playing = false;
    this.onTime?.(this.anchorSong);
    this.emit();
  }

  async toggle() {
    return this.playing ? this.pause() : this.play();
  }

  async seek(t: number) {
    const target = Math.max(0, Math.min(this.duration, t));
    if (this.playing) return this.play(target);
    this.anchorSong = target;
    this.onTime?.(target);
    this.emit();
  }

  private async reflow(apply: () => void) {
    const resumeAt = this.position();
    const wasPlaying = this.playing;
    if (wasPlaying) this.stopSources();
    this.playing = false;
    apply();
    this.anchorSong = resumeAt;
    if (wasPlaying) await this.play(resumeAt);
    else this.emit();
  }

  async setRate(rate: number) {
    const next = Math.max(0.25, Math.min(1.5, rate));
    if (next === this.rate) return;
    await this.reflow(() => { this.rate = next; });
  }

  async setSemitones(semitones: number) {
    const next = Math.max(-12, Math.min(12, Math.round(semitones)));
    if (next === this.semitones) return;
    await this.reflow(() => { this.semitones = next; });
  }

  async setLoop(loop: [number, number] | null) {
    const next = loop && loop[1] - loop[0] > 0.05 ? loop : null;
    this.loop = next;
    if (!this.playing) { this.emit(); return; }
    // restart so the sources pick up the new loop points
    await this.play(next ? Math.max(next[0], Math.min(next[1], this.position())) : this.position());
  }

  setGain(id: string, value: number) {
    this.gains[id] = value;
    const v = this.voices.get(id);
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
    this.stopSources();
    for (const v of this.voices.values()) v.gain.disconnect();
    this.voices.clear();
    this.cache.clear();
    this.renderJob = null;
    this.tracks = [];
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.playing = false;
    this.rendering = null;
    this.anchorSong = 0;
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
