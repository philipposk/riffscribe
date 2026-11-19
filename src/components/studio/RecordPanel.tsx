import { Loader2, Mic, Repeat, Square, Target } from "lucide-react";

import { barsToLoop, type TakeReport } from "@/lib/transcribe/compare";
import { INSTRUMENTS, type Part } from "@/lib/types";
import { barsLabel, type Busy, type Channels, type Setter } from "./constants";

/** Step 5: record a take over the song, and mark it against a part. */
export interface RecordPanelProps {
  recording: boolean;
  stopRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  busy: Busy;
  overdub: Channels | null;
  setOverdub: Setter<Channels | null>;
  nudgeMs: number;
  setNudgeMs: Setter<number>;
  parts: Part[];
  checkTake: () => Promise<TakeReport | string | null>;
  checkPart: string | null;
  setCheckPart: Setter<string | null>;
  report: TakeReport | null;
  loopWorstBars: () => void;
}

export default function RecordPanel({
  recording, stopRecording, startRecording, busy, overdub, setOverdub, nudgeMs, setNudgeMs, parts, checkTake,
  checkPart, setCheckPart, report, loopWorstBars,
}: RecordPanelProps) {
  return (
    <section className="panel no-print mb-5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <span className="step-badge">5</span> Play or sing over it
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button className="btn bg-red-500/20 text-red-200" onClick={stopRecording}>
            <Square size={15} /> Stop
          </button>
        ) : (
          // One press: asks for the microphone if it is not open yet, counts in, then records from the playhead.
          <button
            className="btn btn-primary"
            onClick={() => void startRecording()}
            disabled={!!busy}
            title="Records from the playhead, after the count-in. Asks for the microphone the first time."
          >
            <Mic size={15} aria-hidden /> Record
          </button>
        )}
        {overdub && (
          <button className="btn" onClick={() => setOverdub(null)}>Delete take</button>
        )}
        <label className="ml-2 text-xs text-white/55">
          Nudge take {nudgeMs > 0 ? `+${nudgeMs}` : nudgeMs} ms
          <input type="range" min={-300} max={300} step={5} value={nudgeMs}
            onChange={(e) => setNudgeMs(Number(e.target.value))} className="ml-2 align-middle" />
        </label>
      </div>
      {overdub && parts.length > 0 && (
        <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={checkTake} disabled={!!busy}>
              {busy?.label.startsWith("Listening to your take") ? <Loader2 className="animate-spin" size={15} /> : <Target size={15} />}
              How did I do?
            </button>
            {parts.length > 1 && (
              <select
                className="text-xs"
                value={checkPart ?? parts[0].id}
                onChange={(e) => setCheckPart(e.target.value)}
              >
                {parts.map((x) => (
                  <option key={x.id} value={x.id}>
                    against {INSTRUMENTS[x.instrument].label}
                  </option>
                ))}
              </select>
            )}
            {report && (
              <span className="text-sm">
                <b className={report.accuracy >= 0.9 ? "text-emerald-300" : report.accuracy >= 0.7 ? "text-[var(--color-accent)]" : "text-red-300"}>
                  {Math.round(report.accuracy * 100)}%
                </b>
                <span className="text-white/45"> clean</span>
              </span>
            )}
          </div>

          {report && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
                <span>{report.clean} right</span>
                {report.missed > 0 && <span>{report.missed} missed</span>}
                {report.outOfTune > 0 && <span>{report.outOfTune} out of tune</span>}
                {report.outOfTime > 0 && <span>{report.outOfTime} out of time</span>}
                {report.extra > 0 && <span>{report.extra} not in the part</span>}
                {Math.abs(report.meanMsOff) >= 25 && (
                  <span className="text-[var(--color-accent)]">
                    {report.meanMsOff > 0 ? "dragging" : "rushing"} ~{Math.abs(report.meanMsOff)} ms
                  </span>
                )}
              </div>

              {/* A bar per column, so the shape of the problem is visible at a glance. */}
              <div className="mb-3 flex items-end gap-[3px]" style={{ height: 44 }}>
                {report.bars.map((b) => (
                  <div
                    key={b.bar}
                    title={`Bar ${b.bar}: ${b.clean} of ${b.notes} clean`}
                    className={`w-3 shrink-0 rounded-sm ${
                      b.accuracy >= 0.9 ? "bg-emerald-400/70" : b.accuracy >= 0.6 ? "bg-[var(--color-accent)]/70" : "bg-red-400/70"
                    }`}
                    style={{ height: `${Math.max(8, b.accuracy * 44)}px` }}
                  />
                ))}
              </div>

              {report.worstBars.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-white/55">
                    Weakest {report.worstBars.length === 1 ? "bar" : "bars"}:{" "}
                    {report.worstBars.map((b) => b.bar).join(", ")}
                  </span>
                  <button className="btn text-xs" onClick={loopWorstBars}>
                    <Repeat size={13} /> Loop {barsLabel(barsToLoop(report.worstBars))} and go again
                  </button>
                </div>
              ) : (
                <p className="text-xs text-emerald-300/80">Nothing stands out as weak. Take the speed up.</p>
              )}

              <p className="mt-3 text-xs text-white/35">
                Marked by transcribing your take and lining it up with the written part, so it
                inherits the same blind spots as the transcription — treat a surprising result as
                a question rather than a verdict.
              </p>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-white/45">
        Record at any speed — a take played at 60% is stretched back to full tempo without going
        chipmunk. Use headphones so the backing track does not bleed into the mic.
        {parts.length > 0 && " Mute your own part in the mixer first, so you are playing the line rather than doubling it."}
      </p>
    </section>
  );
}
