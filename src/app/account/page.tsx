import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import AccountPage from "@/components/AccountPage";

export const metadata = { title: "Account — Riffscribe" };

export default function Account() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Account &amp; plan</h1>
        <AccountPage />
      </main>
      <SiteFooter />
    </>
  );
}
