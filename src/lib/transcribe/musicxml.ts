/**
 * Sheet → MusicXML 3.1 (partwise), so the transcription opens in MuseScore,
 * Sibelius, Guitar Pro, Dorico, flat.io, …
 *
 * String/fret data is carried in <notations><technical>, which is the standard
 * way to encode tablature, and the tuning goes in <staff-details> so a TAB
 * staff shows up correctly in apps that support it.
 */
import type { Instrument } from "../types";
import type { Sheet, SheetBar, SheetSlot } from "./quantize";

const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const TYPE_NAME: Record<number, string> = {
  1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th",
};

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

function pitchXml(midi: number) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const alter = ALTER[pc];
  return `<pitch><step>${STEPS[pc]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function slotDuration(slot: SheetSlot, divisionsPerWhole: number) {
  const base = divisionsPerWhole / slot.value;
  return Math.round(slot.dots ? base * 1.5 : base);
}

/** Does this pitch keep sounding into the next slot? */
function continues(bars: SheetBar[], barIdx: number, slotIdx: number, midi: number) {
  const bar = bars[barIdx];
  const next = bar.slots[slotIdx + 1] ?? bars[barIdx + 1]?.slots[0];
  if (!next) return false;
  return next.notes.some((n) => n.midi === midi && n.tied);
}

export interface MusicXmlOptions {
  title?: string;
  artist?: string;
  instrument: Instrument;
  fifths?: number;
  capo?: number;
}

export function sheetToMusicXml(sheet: Sheet, o: MusicXmlOptions): string {
  const inst = o.instrument;
  const stringed = !!inst.tuning?.length;
  const divisionsPerWhole = Math.max(sheet.division, 16);
  const divisionsPerQuarter = divisionsPerWhole / 4;
  const [beats, beatType] = sheet.timeSignature;

  const staffDetails = stringed
    ? `<staff-details><staff-lines>${inst.tuning!.length}</staff-lines>${inst
        .tuning!.slice()
        .reverse()
        .map((midi, i) => {
          const pc = ((midi % 12) + 12) % 12;
          return `<staff-tuning line="${i + 1}"><tuning-step>${STEPS[pc]}</tuning-step>${
            ALTER[pc] ? `<tuning-alter>${ALTER[pc]}</tuning-alter>` : ""
          }<tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave></staff-tuning>`;
        })
        .join("")}${o.capo ? `<capo>${o.capo}</capo>` : ""}</staff-details>`
    : "";

  const clefXml =
    inst.clef === "bass"
      ? `<clef><sign>F</sign><line>4</line></clef>`
      : `<clef><sign>G</sign><line>2</line>${inst.transposeOctaves ? `<clef-octave-change>-1</clef-octave-change>` : ""}</clef>`;

  const measures = sheet.bars
    .map((bar, bi) => {
      const attrs =
        bi === 0
          ? `<attributes><divisions>${divisionsPerQuarter}</divisions><key><fifths>${o.fifths ?? 0}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${clefXml}${staffDetails}</attributes>` +
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(sheet.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(sheet.bpm)}"/></direction>`
          : "";

      const notes = bar.slots
        .map((slot, si) => {
          const dur = slotDuration(slot, divisionsPerWhole);
          const type = TYPE_NAME[slot.value] ?? "quarter";
          const dot = slot.dots ? "<dot/>" : "";
          if (!slot.notes.length) {
            return `<note><rest/><duration>${dur}</duration><type>${type}</type>${dot}</note>`;
          }
          return slot.notes
            .map((n, ni) => {
              const tieStart = continues(sheet.bars, bi, si, n.midi);
              const ties =
                (n.tied ? `<tie type="stop"/>` : "") + (tieStart ? `<tie type="start"/>` : "");
              const tiedNotations =
                (n.tied ? `<tied type="stop"/>` : "") + (tieStart ? `<tied type="start"/>` : "");
              const tech =
                stringed && n.string != null && n.fret != null
                  ? `<technical><string>${n.string}</string><fret>${n.fret}</fret></technical>`
                  : "";
              const notations =
                tiedNotations || tech ? `<notations>${tiedNotations}${tech}</notations>` : "";
              return `<note>${ni ? "<chord/>" : ""}${pitchXml(n.midi)}${ties}<duration>${dur}</duration><type>${type}</type>${dot}${notations}</note>`;
            })
            .join("");
        })
        .join("");

      return `<measure number="${bi + 1}">${attrs}${notes}</measure>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${esc(o.title || "Riffscribe transcription")}</work-title></work>
  <identification>
    ${o.artist ? `<creator type="composer">${esc(o.artist)}</creator>` : ""}
    <encoding><software>Riffscribe</software><encoding-description>Transcribed in-browser with Basic Pitch</encoding-description></encoding>
  </identification>
  <part-list><score-part id="P1"><part-name>${esc(inst.label)}</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}
