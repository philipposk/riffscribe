import Link from "next/link";

const FEATURES = [
  {
    title: "Hear it, read it",
    body: "Basic Pitch — Spotify's note-detection model — listens to the audio and writes out the notes. You get standard notation and tablature side by side, with the frets chosen so your hand barely moves. Guitar, bass, uke, mandolin, banjo, piano, voice, violin, viola, violoncello, double bass, flute, clarinet, sax, trumpet, trombone.",
  },
  {
    title: "Mute the singer",
    body: "Two ways. Instant takes about a second and needs no download. The AI split runs Meta's Demucs right here and hands you four separate tracks — vocals, drums, bass, and everything else — so you can silence any of them.",
  },
  {
    title: "Slow, not slurred",
    body: "Drop to 25% speed and the key stays exactly where it was. Or move the whole song up or down twelve semitones without touching the tempo. Loop the four bars you keep fluffing.",
  },
  {
    title: "Play along, keep the take",
    body: "Record your own part over the backing track. Record it at half speed if you need to — it gets stretched back to full tempo without turning you into a chipmunk — then mix it and export a wav.",
  },
  {
    title: "Reads along with you",
    body: "Turn on follow-the-music and the score scrolls itself, highlighting the beat being played, so you can keep both hands on the instrument. The part is played back in your instrument's voice too — mute it once you can hold the line yourself.",
  },
  {
    title: "A part each, or a whole quartet",
    body: "Write out as many parts as you like \u2014 the bass from one stem, the harmony from another \u2014 and they engrave as one score, a staff each. Any part can then be split into voices and handed to a duo, trio, quartet or quintet. That is arranging one line across players, not pulling the original musicians back out of the recording; nothing can do the latter.",
  },
  {
    title: "Takes your file anywhere",
    body: "Export MIDI, MusicXML for MuseScore or Guitar Pro, alphaTex, printable PDF, and wav \u2014 every part on its own staff, and audio as the whole mix, the backing track, one row of the mixer, or just the bars you looped.",
  },
  {
    title: "Or just ask",
    body: "There is an assistant in the corner that works the studio for you. \u201cSplit the stems and write the bass part out.\u201d \u201cSlow it to 60% and loop the first eight bars.\u201d It presses the same buttons you would.",
  },
  {
    title: "Nothing leaves the room",
    body: "No upload, no account, no queue, no per-minute pricing. The models run inside the browser tab, so the song stays on your machine.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <p className="mb-4 text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Riffscribe</p>
      <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Give it a song. Get the sheet music, the tab, and a backing track.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-white/60">
        Riffscribe listens to a recording and writes down what it hears — notes on a stave and
        numbers on a fretboard. Then it strips the vocals out, slows the whole thing down without
        dropping the pitch, and records you playing over the top.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/studio">Open the studio</Link>
        <a className="btn" href="https://github.com/philipposk/riffscribe">Source on GitHub</a>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <section key={f.title} className="panel p-5">
            <h2 className="mb-2 text-base font-medium text-white">{f.title}</h2>
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
        Signalsmith Stretch (MIT). Part of <a className="underline" href="https://6x7.gr">6x7.gr</a>.
      </footer>
    </main>
  );
}
