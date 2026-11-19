import Link from "next/link";

import SiteHeader, { SiteFooter } from "@/components/SiteHeader";

export const metadata = { title: "Page not found — Riffscribe" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-white/60">That page does not exist, or the link has expired.</p>
        <div className="flex gap-2">
          <Link className="btn btn-primary" href="/">Home</Link>
          <a className="btn" href="/studio">Open the studio</a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
