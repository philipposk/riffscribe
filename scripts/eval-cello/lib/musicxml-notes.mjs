/**
 * MusicXML (uncompressed) to a plain melody: `{ bpm, notes: [midi, beats][] }`, rests as midi 0.
 *
 * Ported from tools/musicxml-to-notes.ts in chimera-vocal-synth, keeping only the note extraction
 * (the lyric, syllable and wasm parts and the .mxl unzip are dropped):
 *   https://github.com/jamesondh/chimera-vocal-synth
 *
 * MIT License
 *
 * Copyright (c) 2026 Jameson Hodge
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * What it does with a part:
 *   - repeats and 1st/2nd endings are written out in play order;
 *   - a tied note becomes one note (its beats added up);
 *   - a chord keeps its first note; grace and cue notes are skipped;
 *   - consecutive rests merge;
 *   - the tempo is the score's first `<sound tempo>` (or a quarter-note metronome mark), unless
 *     `bpm` is given. Later tempo changes are ignored and reported in `warnings`.
 *
 * It throws (with the measure number) on what it does not handle: D.C., D.S., To Coda and Fine,
 * more than one voice in a part, unpitched notes, a score with no tempo and no `bpm`.
 *
 * Beats are in units of the score's quarter note (`duration / divisions`), so seconds are
 * `beats * 60 / bpm`.
 */

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** the text of the first `<name>` in `xml`, or null */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

const has = (xml, name) => new RegExp(`<${name}[\\s/>]`).test(xml);

const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** A start tag's attributes, whatever their order or quotes. */
function attrsOf(s) {
  return Object.fromEntries(
    [...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], unescapeXml(a[2] ?? a[3])])
  );
}

/** The attributes of each `<name ...>` in `xml`, in document order. */
function attrs(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(\\s[^>]*)?>`, "g"))].map((m) => attrsOf(m[1] ?? ""));
}

/** The parts of a score: `[{ id, name }]`. */
export function listParts(xml) {
  return [...xml.matchAll(/<score-part(\s[^>]*)?>([\s\S]*?)<\/score-part>/g)].map((m) => ({
    id: attrsOf(m[1] ?? "").id,
    name: unescapeXml(tag(m[2], "part-name") ?? ""),
  }));
}

/**
 * One part of an uncompressed MusicXML string as a melody.
 * @param {string} xml
 * @param {{ partId?: string, bpm?: number }} [opts] partId defaults to the first part
 * @returns {{ bpm: number, notes: [number, number][], warnings: string[] }}
 */
export function musicXmlToNotes(xml, { partId, bpm: bpmOverride } = {}) {
  const parts = listParts(xml);
  const id = partId ?? parts[0]?.id;
  const body = [...xml.matchAll(/<part(\s[^>]*)?>([\s\S]*?)<\/part>/g)].find((m) => attrsOf(m[1] ?? "").id === id)?.[2];
  if (!body) throw new Error(`no part ${id}; the parts are: ${parts.map((p) => `${p.id} (${p.name})`).join(", ")}`);

  const warnings = [];
  const tempos = attrs(xml, "sound").flatMap((a) => (a.tempo ? [a.tempo] : []));
  // a quarter-note metronome mark counts as a tempo when there is no <sound tempo>
  const marks = [...xml.matchAll(/<metronome\b[^>]*>([\s\S]*?)<\/metronome>/g)]
    .filter((m) => tag(m[1], "beat-unit") === "quarter" && !has(m[1], "beat-unit-dot"))
    .flatMap((m) => (tag(m[1], "per-minute") ? [tag(m[1], "per-minute")] : []));
  const found = tempos.length ? tempos : marks;
  const bpm = Number(bpmOverride ?? found[0]);
  if (!(bpm > 0)) throw new Error(`the score has no tempo (or it is not a number): pass bpm (${bpmOverride ?? found[0]})`);
  if (new Set(found).size > 1) warnings.push(`the score changes tempo (${found.join(", ")}); all of it uses ${bpm} bpm`);

  const measures = [...body.matchAll(/<measure(\s[^>]*)?>([\s\S]*?)<\/measure>/g)].map((m) => ({
    number: attrsOf(m[1] ?? "").number ?? "?",
    xml: m[2],
  }));
  const jump = measures.find((m) => attrs(m.xml, "sound").some((a) => "dacapo" in a || "dalsegno" in a || "tocoda" in a || "fine" in a));
  if (jump) throw new Error(`measure ${jump.number}: D.C., D.S., To Coda and Fine jumps are not supported; write the jumps out in the score`);

  // Play order: repeats and 1st/2nd endings written out.
  const order = [];
  {
    let start = 0;
    let pass = 1;
    let jumped = false;
    let ending = null; // the passes of the ending the walk is in
    for (let i = 0; i < measures.length; ) {
      const m = measures[i];
      const repeats = attrs(m.xml, "repeat");
      const endings = attrs(m.xml, "ending");
      if (repeats.some((r) => r.direction === "forward") && !jumped) {
        start = i;
        pass = 1;
      }
      jumped = false;
      const begins = endings.find((e) => e.type === "start");
      if (begins) ending = (begins.number ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      const play = !ending || ending.includes(pass);
      if (endings.some((e) => e.type === "stop" || e.type === "discontinue")) ending = null;
      if (!play) {
        i++;
        continue;
      }
      order.push(m);
      const back = repeats.find((r) => r.direction === "backward");
      if (back && pass < Number(back.times ?? 2)) {
        pass++;
        i = start;
        jumped = true;
        ending = null;
        continue;
      }
      if (back) {
        start = i + 1;
        pass = 1;
      }
      i++;
    }
  }

  const notes = [];
  let divisions = 0;
  let tieOpen = false;
  for (const { number: measure, xml: mxml } of order) {
    // <attributes>, <note>, <backup> and <forward> in document order
    for (const e of mxml.matchAll(/<(attributes|note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const [, kind, x] = e;
      if (kind === "attributes") {
        const d = tag(x, "divisions");
        if (d) divisions = Number(d);
        continue;
      }
      if (kind !== "note") throw new Error(`measure ${measure}: <${kind}> (more than one voice in a part) is not supported`);
      if (has(x, "chord") || has(x, "grace") || has(x, "cue")) continue;
      if (!divisions) throw new Error("a note before <divisions>");
      const beats = Number(tag(x, "duration")) / divisions;
      if (has(x, "rest")) {
        const last = notes[notes.length - 1];
        if (last && last[0] <= 0) last[1] += beats;
        else notes.push([0, beats]);
        tieOpen = false;
        continue;
      }
      const pitch = tag(x, "pitch");
      if (!pitch) throw new Error(`measure ${measure}: a note with no pitch (unpitched parts are not supported)`);
      const midi = 12 * (Number(tag(pitch, "octave")) + 1) + STEP[tag(pitch, "step") ?? ""] + Math.round(Number(tag(pitch, "alter") ?? 0));
      const ties = new Set(attrs(x, "tie").map((t) => t.type));
      if (tieOpen && ties.has("stop")) {
        notes[notes.length - 1][1] += beats;
        tieOpen = ties.has("start");
        continue;
      }
      tieOpen = ties.has("start");
      notes.push([midi, beats]);
    }
  }
  return { bpm, notes, warnings };
}
