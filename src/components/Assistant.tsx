"use client";
/**
 * The page assistant, wired to the studio and to My songs.
 *
 * Every action it can take is a registered capability that calls the real
 * studio function — the model never invents results, it presses the same
 * buttons you would. Anything slow or destructive asks first.
 *
 * It is mounted once, above the pages (AssistantHost), so a link in a reply —
 * a saved song, or "…and 12 more" — changes page without closing the
 * conversation. The studio lends it the studio's controls while the studio is
 * open (lib/assistantBridge.ts); on My songs only the song list is on offer.
 *
 * Voice is the browser's own speech APIs by default, so it costs nothing.
 *
 * Chats are saved to the player's account while they are signed in, and to this
 * browser otherwise — see lib/assistantHistory.ts.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  GREEK_STRINGS, bcp47, languageInstruction, loadLang, onLangChange, type AssistantLang,
} from "@/lib/assistantLang";
import { studioActions } from "@/lib/assistantBridge";
import { assistantChatHistory } from "@/lib/assistantHistory";
import { matchSongs, songHref, songsHref } from "@/lib/songSearch";
import { listCharts, onAuthChange } from "@/lib/store/charts";
import { savingConfigured, supabase } from "@/lib/supabase/client";

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

/** How many songs a reply names before the rest become one link to My songs. */
const SONGS_SHOWN = 5;

interface SongList {
  query: string;
  total: number;
  songs: { id: string; title: string }[];
}

/**
 * "3 saved songs matching “blues”: [A](/studio?song=…), [B](…), [C](…)."
 * Past SONGS_SHOWN the rest is one link to My songs, searched for the same
 * words, so it opens exactly the songs the reply left out.
 */
function songListReply(
  r: SongList,
  link: (label: string, href: string) => string,
  esc: (text: string) => string,
): string {
  const query = esc(r.query);
  if (!r.total) {
    return r.query
      ? `No saved song matches “${query}”. ${link("See all your songs", songsHref())}.`
      : "You have not saved any songs yet. Transcribe a part in the studio and press Save.";
  }
  const matching = r.query ? ` matching “${query}”` : "";
  const head = r.total === 1 ? `One saved song${matching}: ` : `${r.total} saved songs${matching}: `;
  const names = r.songs.map((s) => link(s.title, songHref(s.id)));
  const more = r.total - r.songs.length;
  if (more > 0) names.push(link(`…and ${more} more`, songsHref(r.query)));
  return `${head}${names.join(", ")}.`;
}

export default function Assistant() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // What the assistant listens and speaks in: chosen in the studio, remembered
  // per device. Unknown until mounted, so the widget does not start once in the
  // wrong language and then again in the right one.
  const [lang, setLang] = useState<AssistantLang | null>(null);
  useEffect(() => {
    setLang(loadLang());
    return onLangChange(setLang);
  }, []);

  useEffect(() => {
    if (lang === null) return;
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
      const { PageAssistant, capability, escapeLinkText, markdownLink, supabaseChatHistoryAdapter } = mod;
      // The studio's controls, while the studio is on screen. Its capabilities
      // are switched off otherwise, so the model only sees them while they work.
      const inStudio = () => studioActions() !== null;
      const a = () => {
        const s = studioActions();
        if (!s) throw new Error("The studio is not open.");
        return s;
      };

      const studioCaps = [
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

      const songsCap = capability({
        name: "find_saved_songs",
        description:
          "List the songs the player has saved to their account, newest first. Pass words from a title to list only the songs whose title contains all of them. Each song in the reply is a link that opens it in the studio.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Words from the song's title. Leave out to list every saved song.",
            },
          },
        },
        // Saved songs need accounts; a deployment without them has none.
        enabled: savingConfigured,
        // The list is the answer, links and all, so it is shown as written
        // rather than retold by the model.
        verbatim: true,
        run: async ({ query }: { query?: string | null }): Promise<SongList> => {
          const hits = matchSongs(await listCharts(), query);
          return {
            query: (query ?? "").trim(),
            total: hits.length,
            songs: hits.slice(0, SONGS_SHOWN).map(({ id, title }) => ({ id, title })),
          };
        },
        render: (r: SongList) => songListReply(r, markdownLink, escapeLinkText),
      });

      const caps = [...studioCaps.map((c) => ({ ...c, enabled: inStudio })), songsCap];

      // Checked again here: the language can change while the import is in
      // flight, and without this the abandoned pass would mount a second
      // widget that nothing owns or tears down.
      if (disposed) return;
      PageAssistant.init({
        serverUrl: "/api/pa",
        appName: "Riffscribe",
        launcherIcon: "sparkle",
        // The tag reaches the microphone, the spoken reply, and Whisper and
        // ElevenLabs where a server voice is configured.
        // Riffscribe's proxy fixes the model on purpose — every plan gets the
        // same small one, and a picker whose choice is quietly ignored would
        // not be honest.
        showModelPicker: false,
        modelFixedNote:
          "Riffscribe runs one small model for everyone, chosen on the server. Your plan sets how many requests you get each month — see Account & plan.",
        // Chat history. Signed in, the default is the player's account: a chat
        // follows them to any device they sign in on. Signed out, or on a
        // deployment without Supabase, chats stay in this browser as they always
        // have. The player can switch in settings (Data tab) to this device only,
        // or to not saving at all, and delete one chat or all of them. Only the
        // text of the conversation is saved, never audio, and RLS keeps each
        // person to their own rows. Chats idle for 12 months are deleted
        // (supabase/assistant_chats.sql). Chats already in this browser stay there
        // until the player chooses to move them; settings offers that.
        chatHistoryMode: "account",
        chatHistoryAdapter: assistantChatHistory(supabase(), supabaseChatHistoryAdapter),
        chatHistoryFallbackMode: "device",
        onChatHistoryError: (e: unknown) => console.warn("[assistant] chat history:", e),
        lang: bcp47(lang),
        strings: lang === "el" ? GREEK_STRINGS : undefined,
        persona:
          "A patient studio hand for a musician learning a part by ear. Practical and brief. You press the same buttons the player would." +
          languageInstruction(lang),
        knowledge:
          "Riffscribe turns a recording into something you can practise: notation and tablature for your instrument, the song with your part removed, a pitch-preserving slow-down, and overdub recording. Everything runs in the browser; audio is never uploaded. You cannot load a song yourself — the player has to pick the file. You can list the songs they have saved; each one is a link that opens it in the studio. The studio's controls only exist while the studio page is open — on My songs, only the song list is on offer.",
        knowledgeUrl: "/llm.txt",
        voice: true,
        capabilities: caps,
        getPageState: () => {
          const s = studioActions();
          if (s) return { page: "studio", ...s.pageState() };
          return { page: location.pathname === "/songs" ? "my songs" : location.pathname, studioOpen: false };
        },
        // A link in a reply changes page through Next's router, so this panel and
        // the conversation in it stay on screen. Leaving the studio mid-job loses
        // the job; a reload would warn about that, but the router does not fire
        // beforeunload, so the same question is asked here.
        onNavigate: (href: string) => {
          const job = studioActions()?.pageState().busy;
          const leaving = new URL(href, location.href).pathname !== "/studio";
          if (job && leaving && !window.confirm(`“${job}” is still running and leaving the studio stops it. Leave anyway?`)) return;
          routerRef.current.push(href);
        },
        suggestions: [
          "Which songs have I saved?",
          "Split the stems and write the bass part out",
          "Write this for violoncello",
          "Slow it to 60% and loop the first eight bars",
          "How did my take go?",
          "Split the harmony into a string quartet",
          "Mute the vocals and export the backing track",
        ],
      });
      // Signing in and out happens in the save bar, not the widget, so tell it
      // who is here now. Deferred a tick: supabase-js asks that its own calls
      // wait until this callback has returned, and the widget's check reads the
      // session.
      const stopAuth = onAuthChange(() => {
        setTimeout(() => void PageAssistant.refreshChatHistory(), 0);
      });
      teardown = () => {
        stopAuth();
        PageAssistant.destroy();
      };
    })();

    return () => {
      disposed = true;
      teardown?.();
      teardown = null;
    };
  }, [lang]);

  return null;
}
