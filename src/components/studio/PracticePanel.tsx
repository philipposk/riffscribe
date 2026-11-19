import { Bookmark } from "lucide-react";

import Waveform from "../Waveform";
import {
  fmtTime, type Busy, type EngineRef, type Loop, type Section, type Setter, type Trainer, type TransportState,
} from "./constants";

/** Step 3: waveform, loop, sections, count-in and speed trainer (the transport is the player bar). */
export interface PracticePanelProps {
  wavePeaks: Float32Array | null;
  transport: TransportState;
  loop: Loop;
  engineRef: EngineRef;
  setLoop: Setter<Loop>;
  trimToLoop: () => void;
  busy: Busy;
  nameLoop: () => void;
  sections: Section[];
  editingSection: number | null;
  setSections: Setter<Section[]>;
  setEditingSection: Setter<number | null>;
  countInBars: number;
  setCountInBars: Setter<number>;
  trainer: Trainer | null;
  setTrainer: Setter<Trainer | null>;
  setPasses: Setter<number>;
  passes: number;
}

export default function PracticePanel({
  wavePeaks, transport, loop, engineRef, setLoop, trimToLoop, busy, nameLoop, sections, editingSection,
  setSections, setEditingSection, countInBars, setCountInBars, trainer, setTrainer, setPasses, passes,
}: PracticePanelProps) {
  return (
    <section className="panel no-print mb-5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <span className="step-badge">3</span> Slow it down
      </h2>
      <Waveform
        peaks={wavePeaks}
        duration={transport.duration}
        time={transport.time}
        loop={loop}
        onSeek={(t) => void engineRef.current?.seek(t)}
        onLoop={setLoop}
      />
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <p className="text-xs text-white/40">Drag across the waveform to loop a section.</p>
        <button className="btn text-xs" onClick={trimToLoop} disabled={!loop || !!busy}>
          Trim song to loop
        </button>
        <button className="btn text-xs" onClick={nameLoop} disabled={!loop}>
          <Bookmark size={13} /> Name this section
        </button>
      </div>

      {sections.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/40">Sections:</span>
          {sections.map((s, i) => (
            <span key={`${s.from}-${s.to}-${i}`} className="flex items-center overflow-hidden rounded bg-white/5">
              {editingSection === i ? (
                <input
                  autoFocus
                  className="w-28 bg-transparent px-2 py-1 text-xs text-white outline-none"
                  defaultValue={s.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim() || s.name;
                    setSections((l) => l.map((x, j) => (j === i ? { ...x, name } : x)));
                    setEditingSection(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingSection(null);
                  }}
                />
              ) : (
                <button
                  className="px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={() => { setLoop([s.from, s.to]); void engineRef.current?.seek(s.from); }}
                  onDoubleClick={() => setEditingSection(i)}
                  title={`${fmtTime(s.from)}–${fmtTime(s.to)} — double-click to rename`}
                >
                  {s.name}
                </button>
              )}
              <button
                className="px-1.5 py-1 text-xs text-white/25 hover:text-white/70"
                onClick={() => setSections((l) => l.filter((_, j) => j !== i))}
                aria-label={`Remove ${s.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-white/60">
          Count-in
          <select
            className="bg-transparent text-xs"
            value={countInBars}
            onChange={(e) => setCountInBars(Number(e.target.value))}
          >
            <option value={0}>off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={!!trainer}
            disabled={!loop}
            onChange={(e) => { setTrainer(e.target.checked ? { step: 0.05, target: 1 } : null); setPasses(0); }}
          />
          Speed trainer
          {trainer && (
            <>
              <span className="text-white/35">+5% a pass, up to</span>
              <select
                className="bg-transparent text-xs"
                value={trainer.target}
                onChange={(e) => setTrainer({ ...trainer, target: Number(e.target.value) })}
              >
                <option value={0.75}>75%</option>
                <option value={0.9}>90%</option>
                <option value={1}>100%</option>
                <option value={1.1}>110%</option>
              </select>
            </>
          )}
        </label>

        {loop && <span className="text-xs text-white/35">{passes} {passes === 1 ? "pass" : "passes"}</span>}
        {!loop && <span className="text-xs text-white/25">The trainer needs a loop.</span>}
      </div>
    </section>
  );
}
