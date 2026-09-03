/**
 * Capability manifest for humans and agents. The assistant fetches this on first
 * open so it understands the product, not just the buttons it can press.
 */
export const dynamic = "force-static";

const TEXT = `# Riffscribe

Turn a recording into something you can practise: sheet music and tablature for
your instrument, the song without the part you are learning, a slow-down player
that keeps the pitch, and a way to record yourself over the top.

Everything runs inside the browser tab. Audio is never uploaded.

## The workflow this exists for

1. Load a song.
2. Split it into stems and mute the instrument you want to play.
3. Transcribe that stem to notation and tab for your instrument.
4. Slow it down, loop the hard bar, and play along with the score following you.
5. Record yourself against the backing track.

## What the assistant can do

The assistant drives the studio directly. It can split stems, transcribe a part,
choose the instrument, change tempo and the note grid, set the speed and key,
loop a section, adjust the mixer, and export files. It cannot load a song for
you — pick the file yourself, because the browser only gives a page access to a
file you chose.

## Instruments

Guitar (6 and 7 string), bass (4 and 5 string), ukulele, mandolin, banjo, piano,
voice, violin, viola, violoncello, double bass, flute, clarinet, alto and tenor
sax, trumpet, trombone. Fretted instruments also get tablature, with the
fingering chosen to keep the hand still.

## Exports

MIDI, MusicXML (opens in MuseScore, Guitar Pro, Dorico), alphaTex, printable PDF,
and wav — the whole mix, the backing track, any single stem, or just the looped
section.

## Honest limits

Automatic transcription is a strong first draft, not a finished chart. It is very
good on a solo instrument, decent on a clean stem, and messy on a dense full mix,
so split the stems first and transcribe one part at a time. Tempo, key, bar
offset and the note grid are all editable, and the MusicXML export exists so the
last ten per cent can be fixed in a real notation editor.
`;

export function GET() {
  return new Response(TEXT, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
