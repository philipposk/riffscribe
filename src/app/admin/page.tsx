import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import AdminSettings from "@/components/AdminSettings";

export const metadata = { title: "Admin — Riffscribe", robots: { index: false } };

export default function Admin() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Admin</h1>
        <AdminSettings />
      </main>
      <SiteFooter />
    </>
  );
}
