"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-white/60">Reload the page. Songs cached on this device are safe.</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        <button type="button" className="btn" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
