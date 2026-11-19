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

/**
 * Speed/pitch settings kept rendered at once. Each is a full-song copy of every track
 * (~140 MB per track for a 4-minute song at 60%), so only the current setting and one
 * other — the one before, or the speed trainer's next step — are kept.
 */
const MAX_RENDERS = 2;

export class PracticeEngine {
  ctx: AudioContext | null = null;
  private tracks: EngineTrack[] = [];
  private voices = new Map<string, Voice>();
  private gains: Record<string, number> = {};
  /** rendered audio per (rate, semitones), one buffer per track id; oldest first */
  private cache = new Map<string, Map<string, AudioBuffer>>();
  private renders = new Map<string, { progress: number; promise: Promise<Map<string, AudioBuffer>> }>();
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
  /** bumped by every play/load: a play that finds it changed was superseded */
  private generation = 0;
  /** bumped whenever the tracks change: a render started before then is stale */
  private epoch = 0;

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

  /** A new song: drop everything, start from 0:00. The audio context is kept. */
  async load(tracks: EngineTrack[], sampleRate: number) {
    this.reset();
    if (this.ctx && sampleRate !== this.sampleRate) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.tracks = tracks;
    this.sampleRate = sampleRate;
    this.duration = tracks.length
      ? Math.max(...tracks.map((t) => t.left.length)) / sampleRate
      : 0;
    this.emit();
  }

  /**
   * The same song with some tracks added, removed or changed (a chart edit, a new BPM, a
   * finished split). Only those tracks are rendered again; playback, position and every
   * other track's rendered audio are kept. Tracks are matched by id and by array identity.
   */
  async updateTracks(tracks: EngineTrack[], sampleRate: number) {
    if (!this.tracks.length || sampleRate !== this.sampleRate) return this.load(tracks, sampleRate);
    const before = new Map(this.tracks.map((t) => [t.id, t]));
    const ids = new Set(tracks.map((t) => t.id));
    const stale: string[] = [];
    for (const t of tracks) {
      const old = before.get(t.id);
      if (!old || old.left !== t.left || old.right !== t.right) stale.push(t.id);
    }
    for (const id of before.keys()) if (!ids.has(id)) stale.push(id);
    this.tracks = tracks;
    if (!stale.length) return;

    this.epoch++;
    this.renders.clear();
    for (const map of this.cache.values()) for (const id of stale) map.delete(id);
    for (const id of stale) {
      if (ids.has(id)) continue;
      const v = this.voices.get(id);
      if (!v) continue;
      this.stopVoice(v);
      v.gain.disconnect();
      this.voices.delete(id);
    }
    if (this.ctx) this.ensureVoices(this.ctx);
    this.duration = tracks.length ? Math.max(...tracks.map((t) => t.left.length)) / sampleRate : 0;

    // Carries on from wherever playback has got to once the changed tracks are ready.
    if (this.playing) await this.play();
    else {
      this.anchorSong = Math.min(this.anchorSong, this.duration);
      this.emit();
    }
  }

  private emit() {
    this.onStateChange?.(this.state());
  }

  /**
   * Create or wake the realtime context now. Browsers (iOS Safari above all) only let a
   * context start inside a user gesture, so call this synchronously in the click before
   * anything that waits, such as a count-in.
   */
  warm(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** The realtime context is created on the first Play, inside the click. */
  private async context() {
    const ctx = this.warm();
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    this.ensureVoices(ctx);
    return ctx;
  }

  private ensureVoices(ctx: AudioContext) {
    for (const track of this.tracks) {
      if (this.voices.has(track.id)) continue;
      const gain = ctx.createGain();
      gain.gain.value = this.gains[track.id] ?? 1;
      gain.connect(ctx.destination);
      this.voices.set(track.id, { id: track.id, gain, source: null });
    }
  }

  private toAudioBuffer(ctx: BaseAudioContext, left: Float32Array, right: Float32Array) {
    const buf = ctx.createBuffer(2, left.length, this.sampleRate);
    buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
    return buf;
  }

  /** Is every current track rendered at this setting? */
  private complete(k: string) {
    const map = this.cache.get(k);
    return !!map && this.tracks.every((t) => map.has(t.id));
  }

  /** Cache a setting as the most recent, dropping the oldest beyond MAX_RENDERS — never the current one. */
  private remember(k: string, map: Map<string, AudioBuffer>) {
    this.cache.delete(k);
    this.cache.set(k, map);
    const current = key(this.rate, this.semitones);
    for (const old of [...this.cache.keys()]) {
      if (this.cache.size <= MAX_RENDERS) break;
      if (old !== k && old !== current) this.cache.delete(old);
    }
  }

  /**
   * Time-stretched audio for the current speed/pitch, rendering it if needed, with the
   * setting and track version it was made for — either may have moved on by the time
   * it is ready. `rate` follows the Signalsmith convention: output length = input / rate.
   */
  private async buffers(): Promise<{ k: string; epoch: number; map: Map<string, AudioBuffer> }> {
    const ctx = await this.context();
    const rate = this.rate;
    const semitones = this.semitones;
    const k = key(rate, semitones);
    const epoch = this.epoch;
    const hit = this.cache.get(k);
    if (hit && this.complete(k)) {
      this.remember(k, hit);
      return { k, epoch, map: hit };
    }

    if (rate === 1 && semitones === 0) {
      const plain = new Map(hit ?? []);
      for (const t of this.tracks) if (!plain.has(t.id)) plain.set(t.id, this.toAudioBuffer(ctx, t.left, t.right));
      this.remember(k, plain);
      return { k, epoch, map: plain };
    }

    return { k, epoch, map: await this.render(rate, semitones) };
  }

  /**
   * Render every track not yet rendered at one speed/pitch and cache it. One job per
   * setting: a request for a setting already being rendered (say, by `prepareRate`) waits
   * for that job instead of starting another. Progress is only shown while the setting
   * being rendered is the one the player is waiting on.
   */
  private render(rate: number, semitones: number): Promise<Map<string, AudioBuffer>> {
    const k = key(rate, semitones);
    const running = this.renders.get(k);
    if (running) {
      if (k === key(this.rate, this.semitones)) {
        this.rendering = running.progress;
        this.emit();
      }
      return running.promise;
    }

    const epoch = this.epoch;
    const have = this.cache.get(k);
    const tracks = this.tracks.filter((t) => !have?.has(t.id));
    const sampleRate = this.sampleRate;
    const job = { progress: 0, promise: null as unknown as Promise<Map<string, AudioBuffer>> };
    // a job made stale by a track change keeps running but no longer drives the display
    const wanted = () => k === key(this.rate, this.semitones) && this.renders.get(k) === job;
    job.promise = (async () => {
      const SignalsmithStretch = await loadStretch();
      const out = new Map(have ?? []);
      let done = 0;
      if (wanted()) {
        this.rendering = 0;
        this.emit();
      }

      for (const track of tracks) {
        const inLength = track.left.length;
        const outLength = Math.ceil(inLength / rate) + Math.ceil(sampleRate * 0.25);
        const off = new OfflineAudioContext(2, outLength, sampleRate);
        const node = await SignalsmithStretch(off, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        // Posted to the worklet without a transfer list, so it is copied there and ours stay intact.
        await node.addBuffers([track.left, track.right]);
        node.connect(off.destination);
        await node.schedule({
          output: 0,
          active: true,
          input: 0,
          rate,
          semitones,
        });
        out.set(track.id, await off.startRendering());
        done++;
        job.progress = done / tracks.length;
        if (wanted()) {
          this.rendering = job.progress;
          this.emit();
        }
      }

      if (epoch === this.epoch) this.remember(k, out);
      // Clear the progress display unless the setting the player now wants is still rendering.
      const current = this.renders.get(key(this.rate, this.semitones));
      if (this.rendering !== null && (!current || current === job)) {
        this.rendering = null;
        this.emit();
      }
      return out;
    })();

    this.renders.set(k, job);
    const clear = () => { if (this.renders.get(k) === job) this.renders.delete(k); };
    job.promise.then(clear, clear);
    return job.promise;
  }

  /**
   * Render a speed ahead of the player asking for it — the speed trainer's next step —
   * so the switch finds it ready. The cache keeps it alongside the current setting.
   * Never throws: if this fails, the real request will render it again and report the error.
   */
  async prepareRate(rate: number) {
    const next = Math.max(0.25, Math.min(1.5, rate));
    if (!this.tracks.length || (next === 1 && this.semitones === 0)) return;
    const k = key(next, this.semitones);
    if (this.complete(k) || this.renders.has(k)) return;
    try {
      await this.render(next, this.semitones);
    } catch {
      /* the real request renders it again and reports the error */
    }
  }

  private stopVoice(v: Voice) {
    if (!v.source) return;
    try {
      v.source.stop();
    } catch {
      /* already stopped */
    }
    v.source.disconnect();
    v.source = null;
  }

  private stopSources() {
    for (const v of this.voices.values()) this.stopVoice(v);
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /** Play from `from`; with no `from`, from where playback is now (or was paused). */
  async play(from?: number): Promise<void> {
    if (!this.tracks.length) return;
    const generation = ++this.generation;
    const ctx = await this.context();
    const { k, epoch, map: buffers } = await this.buffers();
    if (generation !== this.generation) return; // superseded while rendering
    // Speed, pitch or tracks changed while rendering: ask again for what is wanted now.
    if (k !== key(this.rate, this.semitones) || epoch !== this.epoch) return this.play(from);

    const startSong = Math.max(0, Math.min(this.duration, from ?? this.position()));
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
    this.generation++; // a play still waiting on a render must not start after this
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

  /** Stop and forget the tracks and everything rendered from them. The context stays open. */
  private reset() {
    this.generation++;
    this.epoch++;
    this.stopSources();
    for (const v of this.voices.values()) v.gain.disconnect();
    this.voices.clear();
    this.cache.clear();
    this.renders.clear();
    this.tracks = [];
    this.playing = false;
    this.rendering = null;
    this.anchorSong = 0;
    this.duration = 0;
  }

  /** Leaving the studio: also close the audio context. */
  async dispose() {
    this.reset();
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
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
  // mono: both channels share one array (nothing writes to them afterwards)
  return [buf, buf];
}
