import type { NextConfig } from "next";

// Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer (multi-threaded
// WASM) for Demucs. `credentialless` is used instead of `require-corp` so the
// Hugging Face model download still works without CORP headers. Browsers without
// credentialless (Safari) simply fall back to single-threaded WASM / WebGPU.
//
// Only the studio needs it, and `same-origin` COOP cuts the opener link a Google
// sign-in popup posts its credential back through. Every other page therefore
// gets `same-origin-allow-popups`; the studio rule comes later so it wins for
// /studio. Pages that lead to the studio use plain links (full navigations),
// because isolation is decided per document, not per client-side route.
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

// Report-only CSP: it lists what the app loads today and only reports violations, so it
// cannot block the Hugging Face model download or the WASM/worker pages. Tighten and
// enforce it once the report stays quiet. `frame-ancestors` is enforced separately above.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://accounts.google.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://eu.i.posthog.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://accounts.google.com http://127.0.0.1:7749",
  "frame-src https://accounts.google.com",
].join("; ");

// Baseline hardening. The full CSP is report-only for now (see cspReportOnly): onnxruntime
// (WASM, workers), the model download, PostHog, Google sign-in and Supabase each need allowlisting.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }, ...securityHeaders],
    },
    { source: "/studio/:path*", headers: isolationHeaders },
    {
      // Big, immutable ML assets — cache hard.
      source: "/models/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      // Fixed file names that change when onnxruntime-web is bumped, so not immutable:
      // the browser revalidates (a cheap 304) and can never pair a new loader with an old wasm.
      source: "/ort/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
  ],
};

export default nextConfig;
