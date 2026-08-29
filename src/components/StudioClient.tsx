"use client";
/**
 * Client-only shell. The studio is Web Audio + WASM + WebGPU end to end, so it
 * is loaded with ssr:false rather than rendered on the server first.
 */
import dynamic from "next/dynamic";

const Studio = dynamic(() => import("./Studio"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-6xl px-6 py-16 text-sm text-white/50">Loading the studio…</div>
  ),
});

export default function StudioClient() {
  return <Studio />;
}
