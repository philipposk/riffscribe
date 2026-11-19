import { Link as LinkIcon, Upload } from "lucide-react";

import type { Busy, Channels, Setter } from "./constants";

/** Step 1: drop a file, or fetch one through the local helper. */
export interface LoadPanelProps {
  busy: Busy;
  loadFile: (f: File, restoring?: boolean) => Promise<void>;
  file: File | null;
  wantedSong: string | null;
  audio: Channels | null;
  helperUp: boolean | null;
  linkUrl: string;
  setLinkUrl: Setter<string>;
  loadFromLink: (link: string) => Promise<void>;
  log: string;
}

export default function LoadPanel({
  busy, loadFile, file, wantedSong, audio, helperUp, linkUrl, setLinkUrl, loadFromLink, log,
}: LoadPanelProps) {
  return (
    <section className="panel no-print mb-5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <span className="step-badge">1</span> Load a song
      </h2>
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-4 py-8 text-center hover:border-white/30 focus-within:border-[var(--color-accent)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]"
        aria-disabled={!!busy || undefined}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // A split or transcription still running would land on the new song.
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void loadFile(f);
        }}
      >
        <Upload size={20} className="text-white/50" />
        <span className="text-sm">
          {file ? <b>{file.name}</b> : "Drop an mp3, wav, m4a, flac or ogg here — or click to pick one"}
        </span>
        <span className="text-xs text-white/40">Nothing is uploaded. The file never leaves your browser.</span>
        <input
          type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac,audio/*" className="sr-only"
          disabled={!!busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f && !busy) void loadFile(f); }}
        />
      </label>
      {wantedSong && !audio && (
        <p className="mt-4 rounded-lg border border-[var(--color-accent)]/40 bg-[#1a1608] px-4 py-3 text-sm">
          Your notes are open. Drop <b>{wantedSong}</b> above to hear it with its stems — the recording
          isn&rsquo;t on this device, and it never leaves the one it was made on.
        </p>
      )}
      {helperUp && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="min-w-0 flex-1"
            placeholder="…or paste a link (YouTube, SoundCloud, a direct mp3)"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) void loadFromLink(linkUrl.trim()); }}
          />
          <button
            className="btn"
            disabled={!linkUrl.trim() || !!busy}
            onClick={() => void loadFromLink(linkUrl.trim())}
          >
            <LinkIcon size={15} /> Fetch
          </button>
        </div>
      )}
      {log && <p className="mt-3 text-xs text-white/45">{log}</p>}
    </section>
  );
}
