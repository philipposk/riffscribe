/**
 * Small decisions the studio makes about its own state, kept pure so they can be
 * checked without a browser (scripts/verify-studio-state.mjs).
 */

/**
 * Loading a song that is not the one a saved chart was written from starts a new
 * chart. Keeping the chart's id would turn "Save changes" into an overwrite of
 * the other song's chart.
 */
export function keepChartLink(chartSong: string | null, loadedSong: string): boolean {
  return chartSong !== null && chartSong === loadedSong;
}

export interface SavedSettings {
  settings: { bpm: number; offsetSeconds: number } & Record<string, unknown>;
  sections: { name: string; from: number; to: number }[];
  loop: [number, number] | null;
}

/** What was kept for a song, or null when it is missing or not the shape we write. */
export function readSavedSettings(raw: unknown): SavedSettings | null {
  const r = raw as Partial<SavedSettings> | null | undefined;
  const s = r?.settings;
  if (!s || typeof s.bpm !== "number" || !Number.isFinite(s.bpm) || typeof s.offsetSeconds !== "number") return null;
  const sections = Array.isArray(r.sections)
    ? r.sections.filter((x) => x && typeof x.name === "string" && Number.isFinite(x.from) && Number.isFinite(x.to))
    : [];
  const loop =
    Array.isArray(r.loop) && r.loop.length === 2 && r.loop.every((x) => Number.isFinite(x)) && r.loop[1] > r.loop[0]
      ? ([r.loop[0], r.loop[1]] as [number, number])
      : null;
  return { settings: s, sections, loop };
}

export type SettingsOnLoad =
  | { kind: "chart" }
  | { kind: "saved"; value: SavedSettings }
  | { kind: "detected"; bpm: number; offsetSeconds: number };

/**
 * Which tempo and settings a song comes back with.
 * `chartOpen`: a saved chart was just opened and already set its own — leave them.
 * Otherwise the settings kept for this song win, and a song never seen before
 * gets the detected tempo.
 */
export function settingsOnLoad(
  saved: SavedSettings | null,
  chartOpen: boolean,
  tempo: { bpm: number; offsetSeconds: number }
): SettingsOnLoad {
  if (chartOpen) return { kind: "chart" };
  if (saved) return { kind: "saved", value: saved };
  return { kind: "detected", bpm: tempo.bpm, offsetSeconds: tempo.offsetSeconds };
}

/** A solo on a track that no longer exists is no solo at all. */
export function liveSolo(soloed: string | null, trackIds: string[]): string | null {
  return soloed !== null && trackIds.includes(soloed) ? soloed : null;
}

export type TrainerStep = { kind: "up"; rate: number } | { kind: "done" } | { kind: "hold" };

/** What the speed trainer does when a loop pass ends at `rate`. */
export function trainerStep(rate: number, trainer: { step: number; target: number }): TrainerStep {
  const next = Math.min(trainer.target, Math.round((rate + trainer.step) * 100) / 100);
  if (next > rate) return { kind: "up", rate: next };
  if (rate >= trainer.target) return { kind: "done" };
  return { kind: "hold" };
}
