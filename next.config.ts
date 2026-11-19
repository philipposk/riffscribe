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

// Baseline hardening. No full CSP on purpose: onnxruntime (WASM, workers), the model
// download, PostHog, Google sign-in, Supabase and Stripe would each need allowlisting.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
