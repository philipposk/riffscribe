/**
 * Keyboard shortcuts for the studio: one keydown listener on the window.
 *
 * Keys typed into a field, a slider, a dialog or the assistant are theirs, not
 * ours. The mapping and the loop rules are plain functions so they can be
 * checked without a browser (scripts/verify-studio-ux.mjs).
 */
import { useEffect, useRef } from "react";

export type ShortcutAction =
  | "playPause"
  | "home"
  | "back"
  | "forward"
  | "loopStart"
  | "loopEnd"
  | "clearLoop"
  | "slower"
  | "faster"
  | "section"
  | "follow"
  | "muteGuides"
  | "muteVocals"
  | "undo"
  | "help"
  | "restartLoop";

export interface Shortcut {
  action: ShortcutAction;
  /** Section number, 1–9, for "section". */
  n?: number;
}

/** The keys, as the help overlay lists them. */
export const SHORTCUT_HELP: { keys: string[]; does: string }[] = [
  { keys: ["Space"], does: "Play or pause" },
  { keys: ["Home"], does: "Back to the start of the loop, or of the song" },
  { keys: ["←", "→"], does: "Back or forward 5 seconds" },
  { keys: ["[", "]"], does: "Set the loop start or end at the playhead" },
  { keys: ["L"], does: "Clear the loop" },
  { keys: ["-", "="], does: "Slower or faster by 5% (25% to 150%)" },
  { keys: ["1", "…", "9"], does: "Loop section 1 to 9" },
  { keys: ["F"], does: "Score follows the music on or off" },
  { keys: ["M"], does: "Mute or unmute the parts you wrote" },
  { keys: ["V"], does: "Mute or unmute the vocals" },
  { keys: ["⌘/Ctrl", "Z"], does: "Undo a note edit" },
  { keys: ["Page Down"], does: "Play or pause (page-turner pedals)" },
  { keys: ["Page Up"], does: "Back to the start of the loop (page-turner pedals)" },
  { keys: ["?"], does: "This list" },
];

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}

/** Which shortcut a key press means, or null. Held keys repeat only where repeating makes sense. */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.altKey) return null;
  const key = e.key;
  if (e.metaKey || e.ctrlKey) {
    return !e.shiftKey && key.toLowerCase() === "z" && !e.repeat ? { action: "undo" } : null;
  }
  // Seeking and speed may repeat while held; toggles must not flicker.
  switch (key) {
    case "ArrowLeft": return { action: "back" };
    case "ArrowRight": return { action: "forward" };
    case "-": case "_": return { action: "slower" };
    case "=": case "+": return { action: "faster" };
  }
  if (e.repeat) return null;
  switch (key) {
    case " ": case "Spacebar": return { action: "playPause" };
    case "PageDown": return { action: "playPause" };
    case "PageUp": return { action: "restartLoop" };
    case "Home": return { action: "home" };
    case "[": return { action: "loopStart" };
    case "]": return { action: "loopEnd" };
    case "?": return { action: "help" };
  }
  if (/^[1-9]$/.test(key)) return { action: "section", n: Number(key) };
  switch (key.toLowerCase()) {
    case "l": return { action: "clearLoop" };
    case "f": return { action: "follow" };
    case "m": return { action: "muteGuides" };
    case "v": return { action: "muteVocals" };
  }
  return null;
}

/** The id the page assistant's widget gives its host element. */
export const ASSISTANT_HOST_ID = "page-assistant-root";

/** Minimal element shape, so the check runs on plain objects outside a browser. */
interface ElementLike {
  tagName?: string;
  id?: string;
  isContentEditable?: boolean;
  shadowRoot?: unknown;
  getAttribute?: (name: string) => string | null;
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "DIALOG"]);
/** Elements the browser itself activates with Space. */
const ACTIVATED_BY_SPACE = new Set(["BUTTON", "A", "SUMMARY"]);
const SPACE_ROLES = new Set(["button", "checkbox", "switch", "menuitem", "tab", "radio", "option", "link"]);

/**
 * Whether a key press belongs to whatever it was typed into: a field, a slider, an
 * open dialog, an editable element or the assistant (any shadow-DOM host). Space on a
 * focused button is the button's, too.
 */
export function ownedByTarget(path: readonly unknown[], key: string): boolean {
  for (const node of path) {
    const el = node as ElementLike | null;
    if (!el || typeof el !== "object" || typeof el.tagName !== "string") continue;
    const tag = el.tagName.toUpperCase();
    const role = el.getAttribute?.("role") ?? null;
    const editable = el.getAttribute?.("contenteditable");
    if (FIELD_TAGS.has(tag)) return true;
    if (el.isContentEditable || (editable != null && editable !== "false")) return true;
    if (role === "slider" || role === "dialog" || role === "textbox") return true;
    if (el.id === ASSISTANT_HOST_ID || el.shadowRoot) return true;
    if ((key === " " || key === "Spacebar") && (ACTIVATED_BY_SPACE.has(tag) || (role && SPACE_ROLES.has(role)))) return true;
  }
  return false;
}

/** Shortest loop the buttons and keys will set, in seconds; shorter ones (end at 0:00, start at the end) do nothing. */
export const MIN_LOOP = 0.5;

/** Loop start at the playhead: keep the end if it is still after it, otherwise loop the next 4 s. */
export function loopFromStart(time: number, duration: number, loop: [number, number] | null): [number, number] | null {
  if (duration <= 0) return null;
  const r: [number, number] = [time, loop && loop[1] > time ? loop[1] : Math.min(duration, time + 4)];
  return r[1] - r[0] >= MIN_LOOP ? r : null;
}

/** Loop end at the playhead: keep the start if it is still before it, otherwise loop the last 4 s. */
export function loopToEnd(time: number, duration: number, loop: [number, number] | null): [number, number] | null {
  if (duration <= 0) return null;
  const r: [number, number] = [loop && loop[0] < time ? loop[0] : Math.max(0, time - 4), time];
  return r[1] - r[0] >= MIN_LOOP ? r : null;
}

/** Speed one 5% step slower or faster, on the 5% grid, within 25–150%. */
export function stepRate(rate: number, dir: 1 | -1): number {
  const next = Math.round(rate * 20 + dir) / 20;
  return Math.min(1.5, Math.max(0.25, Math.round(next * 100) / 100));
}

/** A handler answers false when the key did nothing, so the browser keeps its default. */
export type ShortcutHandlers = Partial<Record<ShortcutAction, (s: Shortcut) => boolean | void>>;

export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const s = shortcutFor(e);
      if (!s) return;
      if (ownedByTarget(e.composedPath(), e.key)) return;
      const run = latest.current[s.action];
      if (!run) return;
      if (run(s) === false) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
