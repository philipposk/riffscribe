"use client";

// Replaces the root layout when it fails, so it brings its own <html>, <body>
// and styles (globals.css is not guaranteed to have loaded).
export default function GlobalError() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 20,
          textAlign: "center",
          background: "#08090c",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>Something went wrong</h1>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.65 }}>Reload the page. Songs cached on this device are safe.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#f0b429", color: "#16130a", fontSize: 14, cursor: "pointer" }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
