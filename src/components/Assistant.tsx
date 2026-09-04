"use client";
/**
 * The page assistant, wired to the studio.
 *
 * Every action it can take is a registered capability that calls the real
 * studio function — the model never invents results, it presses the same
 * buttons you would. Anything slow or destructive asks first.
 *
 * Voice is the browser's own speech APIs by default, so it costs nothing.
 */
import { useEffect, useRef } from "react";

export interface AssistantActions {
  describe: () => string;
  setInstrument: (id: string) => string;
  splitStems: (mode: "instant" | "ai") => Promise<string>;
  transcribe: (source?: string) => Promise<string>;
  setTempo: (bpm: number) => string;
  setGrid: (division: number) => string;
  setCapo: (fret: number) => string;
  setWrittenTranspose: (semitones: number) => string;
  play: () => Promise<string>;
  pause: () => Promise<string>;
  seek: (seconds: number) => Promise<string>;
  setSpeed: (percent: number) => Promise<string>;
  setKeyShift: (semitones: number) => Promise<string>;
  setLoop: (from: number, to: number) => Promise<string>;
  clearLoop: () => Promise<string>;
  setTrack: (track: string, change: { level?: number; muted?: boolean; solo?: boolean }) => string;
  exportFile: (what: string) => string;
  setPlayAlong: (on: boolean) => string;
  arrange: (size: number) => string;
  checkTake: () => Promise<string>;
  loopWeakest: () => string;
  pageState: () => Record<string, unknown>;
}

const INSTRUMENT_IDS = [
  "guitar", "guitar-7", "bass", "bass-5", "ukulele", "mandolin", "banjo", "piano", "voice",
  "violin", "viola", "cello", "double-bass", "flute", "clarinet", "alto-sax", "tenor-sax",
  "trumpet", "trombone",
];

export default function Assistant({ actions }: { actions: AssistantActions }) {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    // React runs effects twice in development. Loading the widget is async, so the
    // first pass is always torn down before its import resolves — that pass bails
    // out and the second one mounts for real. A "have I started?" ref would block
    // that second pass, and the assistant would never appear while developing.
    let disposed = false;
    let teardown: (() => void) | null = null;

    (async () => {
      let mod: typeof import("@page-assistant/widget");
      try {
        mod = await import("@page-assistant/widget");
      } catch {
        return; // the assistant is optional — the studio works without it
      }
      if (disposed) return;
      const { PageAssistant, capability } = mod;
      const a = () => latest.current;

      const caps = [
        capability({
          name: "describe_studio",
          description:
            "Report what is currently loaded: the song, whether stems exist, whether a part has been transcribed, the instrument, tempo, key, speed and loop.",
          parameters: { type: "object", properties: {} },
          run: async () => ({ text: a().describe() }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "choose_instrument",
          description:
            "Choose which instrument the part is written for. This changes the notation, the tablature and the sound of the guide playback.",
          parameters: {
            type: "object",
            properties: { instrument: { type: "string", enum: INSTRUMENT_IDS } },
            required: ["instrument"],
          },
          run: async ({ instrument }: { instrument: string }) => ({ text: a().setInstrument(instrument) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "split_stems",
          description:
            "Separate the song. 'instant' pulls the centred vocal out in about a second. 'ai' runs Demucs for four real stems (vocals, drums, bass, everything else) and downloads a 180 MB model the first time, which takes minutes.",
          parameters: {
            type: "object",
            properties: { mode: { type: "string", enum: ["instant", "ai"] } },
            required: ["mode"],
          },
          confirm: true,
          run: async ({ mode }: { mode: "instant" | "ai" }) => ({ text: await a().splitStems(mode) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "transcribe_part",
          description:
            "Write out the notes for the chosen instrument. Optionally pick which part to listen to: the full mix, or one of the separated stems.",
          parameters: {
            type: "object",
            properties: {
              source: { type: "string", enum: ["mix", "vocals", "drums", "bass", "other"] },
            },
          },
          confirm: true,
          run: async ({ source }: { source?: string }) => ({ text: await a().transcribe(source) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "set_notation",
          description:
            "Adjust how the part is written down: the tempo in BPM, the note grid it snaps to, a capo position, or a transposition of the written notes.",
          parameters: {
            type: "object",
            properties: {
              bpm: { type: "number" },
              grid: { type: "number", enum: [4, 8, 16, 32] },
              capo: { type: "number" },
              transposeSemitones: { type: "number" },
            },
          },
          run: async (args: { bpm?: number; grid?: number; capo?: number; transposeSemitones?: number }) => {
            const done: string[] = [];
            if (typeof args.bpm === "number") done.push(a().setTempo(args.bpm));
            if (typeof args.grid === "number") done.push(a().setGrid(args.grid));
            if (typeof args.capo === "number") done.push(a().setCapo(args.capo));
            if (typeof args.transposeSemitones === "number")
              done.push(a().setWrittenTranspose(args.transposeSemitones));
            return { text: done.join(" ") || "Nothing to change." };
          },
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "transport",
          description: "Start or stop playback, or jump to a position in seconds.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["play", "pause", "seek"] },
              seconds: { type: "number" },
            },
            required: ["action"],
          },
          run: async ({ action, seconds }: { action: string; seconds?: number }) => {
            if (action === "play") return { text: await a().play() };
            if (action === "pause") return { text: await a().pause() };
            return { text: await a().seek(seconds ?? 0) };
          },
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "set_practice_speed",
          description:
            "Set the playback speed as a percentage (25 to 150). The pitch does not change. Changing it re-renders the audio, which takes a moment.",
          parameters: {
            type: "object",
            properties: { percent: { type: "number" } },
            required: ["percent"],
          },
          run: async ({ percent }: { percent: number }) => ({ text: await a().setSpeed(percent) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "set_key",
          description:
            "Move the whole song up or down by semitones so it sits in your range. The tempo does not change.",
          parameters: {
            type: "object",
            properties: { semitones: { type: "number" } },
            required: ["semitones"],
          },
          run: async ({ semitones }: { semitones: number }) => ({ text: await a().setKeyShift(semitones) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "set_loop",
          description:
            "Loop a section for drilling, given start and end in seconds. Pass clear=true to stop looping.",
          parameters: {
            type: "object",
            properties: {
              fromSeconds: { type: "number" },
              toSeconds: { type: "number" },
              clear: { type: "boolean" },
            },
          },
          run: async (args: { fromSeconds?: number; toSeconds?: number; clear?: boolean }) => {
            if (args.clear || args.fromSeconds == null || args.toSeconds == null) {
              return { text: await a().clearLoop() };
            }
            return { text: await a().setLoop(args.fromSeconds, args.toSeconds) };
          },
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "mix_track",
          description:
            "Change one track in the mixer: its level (0 to 150), mute it, or solo it. Track names are the mixer rows, e.g. vocals, drums, bass, other, original, guide, click, overdub.",
          parameters: {
            type: "object",
            properties: {
              track: { type: "string" },
              level: { type: "number" },
              muted: { type: "boolean" },
              solo: { type: "boolean" },
            },
            required: ["track"],
          },
          run: async (args: { track: string; level?: number; muted?: boolean; solo?: boolean }) => ({
            text: a().setTrack(args.track, {
              level: args.level,
              muted: args.muted,
              solo: args.solo,
            }),
          }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "export_file",
          description:
            "Download something: the sheet music as MIDI, MusicXML, alphaTex or PDF, or audio as the backing track, the current mix, or a single track by name.",
          parameters: {
            type: "object",
            properties: { what: { type: "string" } },
            required: ["what"],
          },
          confirm: true,
          run: async ({ what }: { what: string }) => ({ text: a().exportFile(what) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "arrange_for_ensemble",
          description:
            "Split the harmony part that has already been transcribed into separate voices and give each one to an instrument — a duo, trio, quartet or quintet. This arranges one line across players; it does not recover the original musicians from the recording.",
          parameters: {
            type: "object",
            properties: { size: { type: "number", enum: [2, 3, 4, 5] } },
            required: ["size"],
          },
          confirm: true,
          run: async ({ size }: { size: number }) => ({ text: a().arrange(size) }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "check_take",
          description:
            "Mark the take the player just recorded against the written part — how much was clean, what was missed, what sat out of tune or out of time, and which bars are weakest. Needs a recording and a transcribed part.",
          parameters: { type: "object", properties: {} },
          run: async () => ({ text: await a().checkTake() }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "loop_weakest_bars",
          description:
            "Set the practice loop around the bars that came out worst in the last take, and go back to their start.",
          parameters: { type: "object", properties: {} },
          run: async () => ({ text: a().loopWeakest() }),
          render: (r: { text: string }) => r.text,
        }),
        capability({
          name: "set_play_along",
          description:
            "Turn the follow-the-music view on or off — the score scrolls itself and highlights the beat being played.",
          parameters: {
            type: "object",
            properties: { on: { type: "boolean" } },
            required: ["on"],
          },
          run: async ({ on }: { on: boolean }) => ({ text: a().setPlayAlong(on) }),
          render: (r: { text: string }) => r.text,
        }),
      ];

      PageAssistant.init({
        serverUrl: "/api/pa",
        appName: "Riffscribe",
        launcherIcon: "sparkle",
        persona:
          "A patient studio hand for a musician learning a part by ear. Practical and brief. You press the same buttons the player would.",
        knowledge:
          "Riffscribe turns a recording into something you can practise: notation and tablature for your instrument, the song with your part removed, a pitch-preserving slow-down, and overdub recording. Everything runs in the browser; audio is never uploaded. You cannot load a song yourself — the player has to pick the file.",
        knowledgeUrl: "/llm.txt",
        voice: true,
        capabilities: caps,
        getPageState: () => a().pageState(),
        suggestions: [
          "Split the stems and write the bass part out",
          "Write this for violoncello",
          "Slow it to 60% and loop the first eight bars",
          "How did my take go?",
          "Split the harmony into a string quartet",
          "Mute the vocals and export the backing track",
        ],
      });
      teardown = () => PageAssistant.destroy();
    })();

    return () => {
      disposed = true;
      teardown?.();
      teardown = null;
    };
  }, []);

  return null;
}
