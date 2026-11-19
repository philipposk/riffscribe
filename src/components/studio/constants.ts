/** Shared types, labels and small pure helpers for the studio and its panels. */
import type { Dispatch, SetStateAction } from "react";

import type { PracticeEngine } from "@/lib/audio/engine";
import { playsSingleLine } from "@/lib/transcribe/voices";
import { INSTRUMENTS, type InstrumentId, type TranscriptionSettings } from "@/lib/types";

export type Busy = { label: string; value?: number } | null;
export type StemMode = "none" | "instant" | "ai";
export type Source = "mix" | "vocals" | "drums" | "bass" | "other";

/** A React state setter, as the panels receive them. */
export type Setter<T> = Dispatch<SetStateAction<T>>;
export type Channels = { left: Float32Array; right: Float32Array };
export type Loop = [number, number] | null;
export type MixState = Record<string, { gain: number; muted: boolean }>;
export type ExportFormat = "wav" | "mp3";
export type Section = { name: string; from: number; to: number };
export type Trainer = { step: number; target: number };
export type TrackMeta = { id: string; label: string; hint?: string };
export type GuideTrack = { id: string; left: Float32Array; right: Float32Array };
export type EngineRef = { readonly current: PracticeEngine | null };
export type TransportState = {
  playing: boolean; time: number; duration: number; rate: number; semitones: number; rendering: number | null;
};

export const STEM_LABEL: Record<string, { label: string; hint: string }> = {
  vocals: { label: "Vocals", hint: "lead + backing voices" },
  drums: { label: "Drums", hint: "kit and percussion" },
  bass: { label: "Bass", hint: "bass guitar / synth bass" },
  other: { label: "Everything else", hint: "guitars, keys, strings" },
  original: { label: "Song", hint: "the original mix" },
  click: { label: "Click", hint: "metronome, follows the speed" },
  overdub: { label: "Your take", hint: "what you recorded" },
  guide: { label: "Your part", hint: "the transcription, played back" },
};

/** Which instruments a voice split is handed to, top line first. */
export const ENSEMBLES: Record<number, InstrumentId[]> = {
  2: ["violin", "cello"],
  3: ["violin", "viola", "cello"],
  4: ["violin", "violin", "viola", "cello"],
  5: ["violin", "violin", "viola", "cello", "double-bass"],
};

/** "bar 4" or "bars 3–5", for a run of bar numbers in order. */
export const barsLabel = (bars: number[]) =>
  bars.length === 1 ? `bar ${bars[0]}` : `bars ${bars[0]}–${bars[bars.length - 1]}`;

/** Picking an instrument also picks its usual single-line setting, which can still be changed. */
export const instrumentPatch = (id: InstrumentId): Partial<TranscriptionSettings> => ({
  instrument: id,
  monophonic: playsSingleLine(INSTRUMENTS[id]),
});

/** m:ss */
export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
