import type { NextConfig } from "next";

// Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer (multi-threaded
// WASM) for Demucs. `credentialless` is used instead of `require-corp` so the
// Hugging Face model download still works without CORP headers. Browsers without
// credentialless (Safari) simply fall back to single-threaded WASM / WebGPU.
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    { source: "/(.*)", headers: isolationHeaders },
    {
      // Big, immutable ML assets — cache hard.
      source: "/models/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/ort/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
  ],
};

export default nextConfig;
