/**
 * What went wrong, said as a sentence with a next step. The original message is
 * kept in parentheses: it is what someone helping will ask for.
 */
export type ErrorContext = "decode" | "split" | "transcribe" | "engine" | "record" | "chart";

const NEXT_STEP: Record<ErrorContext, string> = {
  decode:
    "That file could not be opened. Try an mp3, wav, m4a or flac file, or export it again from where it came from.",
  split:
    "The split did not finish. Try the instant split, or trim the song to your loop and run it again.",
  transcribe:
    "The notes could not be written out. Trim the song to your loop, or pick one stem instead of the full mix, and run it again.",
  engine:
    "Playback could not start. Reload the page: your song, stems and parts are kept on this device.",
  record:
    "The take could not be recorded. Check that the microphone is connected and allowed, then try again.",
  chart:
    "That song could not be opened. Check your connection, then open it again from My songs.",
};

/** The error's own words, or "" when it has none worth showing. */
function detailOf(e: unknown): string {
  if (e instanceof Error) return e.message.trim();
  if (typeof e === "string") return e.trim();
  return "";
}

export function humanError(e: unknown, context: ErrorContext): string {
  const sentence = NEXT_STEP[context];
  const detail = detailOf(e);
  return detail && detail !== sentence ? `${sentence} (${detail})` : sentence;
}
