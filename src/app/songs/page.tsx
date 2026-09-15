import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import Songs from "@/components/Songs";

export const metadata = { title: "My songs — Riffscribe" };

export default function SongsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">My songs</h1>
        <Songs />
      </main>
      <SiteFooter />
    </>
  );
}
