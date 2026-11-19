/**
 * The studio's downloads: notation (MIDI, MusicXML, alphaTex) and audio (one
 * track, the backing, or the current mix). Everything they read is passed in.
 */
import { encodeMp3 } from "@/lib/audio/mp3";
import { stretchOffline } from "@/lib/audio/recorder";
import { DEMUCS_SAMPLE_RATE, mixStems, type StemSet } from "@/lib/audio/stems";
import { downloadBlob, encodeWav } from "@/lib/audio/wav";
import type { PartSheet } from "@/lib/transcribe/engrave";
import { partsToMidi } from "@/lib/transcribe/midi";
import { sheetsToMusicXml } from "@/lib/transcribe/musicxml";
import { INSTRUMENTS, type Part } from "@/lib/types";
import type {
  Busy, Channels, ExportFormat, GuideTrack, Loop, MixState, StemMode, TrackMeta,
} from "./constants";

export function exportMidi(parts: Part[], bpm: number, baseName: string) {
  if (!parts.length) return;
  const bytes = partsToMidi(
    parts.map((p) => ({
      notes: p.notes,
      name: INSTRUMENTS[p.instrument].label,
      program: INSTRUMENTS[p.instrument].gm,
    })),
    { bpm, name: baseName }
  );
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "audio/midi" }), `${baseName}.mid`);
}

export function exportMusicXml(partSheets: PartSheet[], capo: number, baseName: string) {
  if (!partSheets.length) return;
  const xml = sheetsToMusicXml(
    partSheets.map(({ sheet: sh, instrument, fifths, clef }) => ({
      sheet: sh,
      options: {
        instrument,
        fifths,
        clef,
        capo,
        partName: instrument.label,
      },
    })),
    { title: baseName }
  );
  downloadBlob(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }), `${baseName}.musicxml`);
}

export function exportTex(tex: string, baseName: string) {
  if (!tex) return;
  downloadBlob(new Blob([tex], { type: "text/plain" }), `${baseName}.alphatex`);
}

/** What the audio exports read, as it stands in the render that asked for one. */
export interface AudioExport {
  audio: Channels | null;
  stems: StemSet | null;
  stemMode: StemMode;
  overdub: Channels | null;
  guideTracks: GuideTrack[];
  clickTrack: Channels | null;
  trackList: TrackMeta[];
  mix: MixState;
  activeSolo: string | null;
  loop: Loop;
  loopOnlyExport: boolean;
  transport: { rate: number; semitones: number };
  exportFormat: ExportFormat;
  baseName: string;
  setBusy: (b: Busy) => void;
  setError: (e: string | null) => void;
}

/** Every track that currently exists, keyed the same way as the mixer. */
function allParts(x: AudioExport): Record<string, Channels> {
  const { stems, audio, overdub, guideTracks, clickTrack } = x;
  const mixParts: Record<string, Channels> = stems
    ? { ...stems }
    : audio
      ? { original: audio }
      : {};
  if (overdub) mixParts.overdub = overdub;
  for (const g of guideTracks) mixParts[g.id] = { left: g.left, right: g.right };
  if (clickTrack) mixParts.click = clickTrack;
  return mixParts;
}

/** Whole song, or just the looped section when the user asked for that. */
function exportWindow(x: AudioExport) {
  const { audio, loopOnlyExport, loop } = x;
  const total = audio ? audio.left.length : 0;
  if (!loopOnlyExport || !loop) return { from: 0, to: total, suffix: "" };
  const from = Math.max(0, Math.floor(loop[0] * DEMUCS_SAMPLE_RATE));
  const to = Math.min(total, Math.floor(loop[1] * DEMUCS_SAMPLE_RATE));
  return { from, to, suffix: `-${Math.round(loop[0])}s-${Math.round(loop[1])}s` };
}

/** Slice the loop if asked, then bake the current practice speed and key. */
export async function prepareExport(x: AudioExport, channels: Channels) {
  const { from, to } = exportWindow(x);
  const left = from || to < channels.left.length ? channels.left.slice(from, to) : channels.left;
  const right = from || to < channels.right.length ? channels.right.slice(from, to) : channels.right;
  const { rate, semitones } = x.transport;
  if (Math.abs(rate - 1) < 1e-4 && semitones === 0) return { left, right };
  const [l, r] = await stretchOffline([left, right], DEMUCS_SAMPLE_RATE, rate, semitones);
  return { left: l, right: r };
}

export async function downloadChannels(x: AudioExport, channels: Channels, name: string) {
  const { transport, setBusy, exportFormat, baseName } = x;
  const { suffix } = exportWindow(x);
  const needsBake = Math.abs(transport.rate - 1) >= 1e-4 || transport.semitones !== 0;
  if (needsBake) setBusy({ label: "Rendering export at your practice speed and key…" });
  try {
    const baked = await prepareExport(x, channels);
    const blob =
      exportFormat === "mp3"
        ? encodeMp3([baked.left, baked.right], DEMUCS_SAMPLE_RATE)
        : encodeWav([baked.left, baked.right], DEMUCS_SAMPLE_RATE);
    downloadBlob(blob, `${baseName}-${name}${suffix}.${exportFormat}`);
  } finally {
    if (needsBake) setBusy(null);
  }
}

export async function exportAudio(x: AudioExport, kind: "backing" | "mix") {
  const { audio, stems, stemMode, trackList, mix, activeSolo, setError } = x;
  if (!audio) return;
  const length = audio.left.length;

  if (kind === "backing" && stems) {
    // everything except the vocals, at full level, whatever the faders say
    const keys = stemMode === "instant" ? ["other"] : ["drums", "bass", "other"];
    setError(null);
    await downloadChannels(x, mixStems(stems, keys, { length }), "backing");
    return;
  }

  const parts = allParts(x);
  const gains: Record<string, number> = {};
  const audible = trackList
    .map((t) => t.id)
    .filter((id) => {
      if (!parts[id]) return false;
      const m = mix[id] ?? { gain: 1, muted: false };
      if (m.muted || (activeSolo !== null && activeSolo !== id)) return false;
      gains[id] = m.gain;
      return true;
    });

  if (!audible.length) {
    setError("Everything is muted or soloed out — nothing to export.");
    return;
  }
  setError(null);
  await downloadChannels(x, mixStems(parts, audible, { length, gains }), "mix");
}

/** One track on its own — the stem, your part, your take, the click. */
export async function exportTrack(x: AudioExport, id: string) {
  const part = allParts(x)[id];
  if (!part) return;
  x.setError(null);
  await downloadChannels(x, part, id);
}
