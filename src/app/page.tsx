import type { Metadata } from "next";
import { AudioLines, Ear, FileMusic, Gauge, MessageCircle, MicOff, Mic, Pencil, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import SiteHeader, { SiteFooter } from "@/components/SiteHeader";

// Only the home page is canonical to "/"; other pages keep their own URL.
export const metadata: Metadata = { alternates: { canonical: "/" } };

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MicOff,
    title: "Remove the voice",
    body: "Instant mode takes about a second and needs no download. The AI split runs Meta\u2019s Demucs right in your browser and hands you vocals, drums, bass and the rest as separate tracks, so you can silence the singer and keep the band.",
  },
  {
    icon: AudioLines,
    title: "Hear the line on your instrument",
    body: "Riffscribe writes down what the singer sang, then plays that line back in the voice of your cello, guitar or sax. You learn the phrasing from a player\u2019s sound, not from a vocal you cannot copy.",
  },
  {
    icon: Gauge,
    title: "Practise slow, then up to speed",
    body: "Drop to 25% speed and the key stays where it was. Loop the four bars you keep fluffing, and let the speed trainer nudge the tempo up each clean pass until you reach full speed.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Ear,
    title: "Hear it, read it",
    body: "Basic Pitch, Spotify\u2019s note-detection model, writes out the notes. You get notation and tablature side by side, for guitar, bass, piano, voice, strings, woodwind and brass.",
  },
  {
    icon: Pencil,
    title: "Fix what it mishears",
    body: "Automatic transcription is a first draft. Click a note on the staff and move it a semitone or an octave, or take it out, with an undo.",
  },
  {
    icon: Mic,
    title: "Play along, keep the take",
    body: "Record your own part over the backing track, even at half speed. It is stretched back to full tempo without turning you into a chipmunk, then mixed and exported as a wav.",
  },
  {
    icon: Target,
    title: "Tells you how it went",
    body: "Your take is marked against the written part: what was clean, what you missed, what sat flat or came in late, and which bars are weakest, with one press to loop those and go again.",
  },
  {
    icon: FileMusic,
    title: "Takes your file anywhere",
    body: "Export MIDI, MusicXML for MuseScore or Guitar Pro, alphaTex, a printable PDF and wav, with every part on its own staff.",
  },
  {
    icon: MessageCircle,
    title: "Or just ask",
    body: "An assistant in the corner works the studio for you: \u201cSlow it to 60% and loop the first eight bars.\u201d It presses the same buttons you would. The assistant needs a free account.",
  },
];

export default function Home() {
  return (
    <>
    <SiteHeader />
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <p className="mb-4 text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Riffscribe</p>
      <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Learn any part by ear.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-white/60">
        Take the singer out, and let your cello — or guitar, or sax — play the line while you
        learn it. Free; Pro €5 a month for more saved songs.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <a className="btn btn-primary" href="/studio?demo=1">Try the demo song</a>
        <a className="btn" href="/studio">Open your own</a>
      </div>
      <p className="mt-3 text-xs text-white/40">
        Runs in your browser. Nothing is uploaded, and no account is needed to transcribe.
      </p>

      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <section key={s.title} className="panel p-5">
            <s.icon className="mb-3 text-[var(--color-accent)]" size={22} aria-hidden="true" />
            <h2 className="mb-2 text-base font-medium text-white">{s.title}</h2>
            <p className="text-sm leading-relaxed text-white/55">{s.body}</p>
          </section>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <section key={f.title} className="panel p-4">
            <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-white">
              <f.icon className="text-white/50" size={15} aria-hidden="true" /> {f.title}
            </h2>
            <p className="text-sm leading-relaxed text-white/55">{f.body}</p>
          </section>
        ))}
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="mb-2 text-base font-medium">Being straight with you about accuracy</h2>
        <p className="text-sm leading-relaxed text-white/55">
          Automatic transcription is not a human transcriber. It is very good on a solo instrument,
          decent on a clean stem, and messy on a dense full mix — so split the stems first and
          transcribe one at a time. Treat the output as a strong first draft: the rhythm grid,
          tempo and key are all editable, and the exported MusicXML opens in MuseScore for cleanup.
        </p>
      </section>

      <footer className="mt-12 text-xs text-white/30">
        Built on Basic Pitch (Spotify, Apache-2.0), Demucs (Meta, MIT), alphaTab (MPL-2.0) and
        Signalsmith Stretch (MIT).
      </footer>
    </main>
    <SiteFooter />
    </>
  );
}
