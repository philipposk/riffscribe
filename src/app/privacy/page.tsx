// DRAFT — have a Danish lawyer review before relying on it.
import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import { CookieSettingsButton } from "@/components/ConsentBanner";
import { COMPANY, companyComplete } from "@/lib/company";

export const metadata = { title: "Privacy — Riffscribe" };

const UPDATED = "19 November 2026";

/** What we process, why, and the legal basis (GDPR art. 6). */
const PROCESSING = [
  ["Account email", "Signing you in and showing your account", "Contract"],
  ["Saved charts", "Storing the songs you choose to save", "Contract"],
  ["Usage counts", "Applying your plan’s limits (songs saved, assistant requests this month)", "Contract"],
  ["Billing", "Your plan and subscription status. Invoices are kept for 5 years under Danish bookkeeping law", "Contract; legal obligation"],
  ["Assistant chats", "Showing your chats across devices. You can keep them on this device only, or not save them", "Contract"],
  ["Analytics", "Counting page visits", "Consent"],
  ["Abuse limits", "Your IP address is held in memory to rate-limit requests and is not stored", "Legitimate interest"],
];

/** Everyone who handles personal data for us, with where and under which transfer mechanism. */
const PROCESSORS = [
  ["Supabase", "Accounts, saved charts, usage", "EU (Frankfurt)", "Stays in the EU"],
  ["Vercel", "Hosting", "US company, EU and US edge", "EU–US Data Privacy Framework and standard contractual clauses"],
  ["Stripe Payments Europe, Ltd.", "Payments. We never see your card. Stripe is an independent controller for fraud and compliance", "Ireland, with US transfers", "Data Privacy Framework and standard contractual clauses"],
  ["Anthropic", "The assistant’s language model. API data is not used for training", "US", "Data Privacy Framework and standard contractual clauses"],
  ["OpenRouter", "Fallback for the assistant’s language model, and the model providers it routes to", "US", "Standard contractual clauses"],
  ["PostHog", "Page-view analytics, only if you accept. No session recording", "EU cloud", "Stays in the EU"],
  ["Google", "Sign-in, only if you choose it", "US company", "Data Privacy Framework and standard contractual clauses"],
];

const STORAGE = [
  ["Sign-in session", "localStorage", "Keeps you signed in", "Necessary"],
  ["rs_at", "Cookie (sent to /api only)", "Lets the assistant and billing requests prove who you are", "Necessary"],
  ["Stems, transcriptions, last song, partial splits", "IndexedDB on this device", "Caches your work so it is not recomputed. Never leaves the device", "Necessary"],
  ["riffscribe:consent", "localStorage", "Remembers your analytics choice", "Necessary"],
  ["Google Identity script", "Loaded from accounts.google.com", "Only on the sign-in screen, so Google can show its button", "Necessary for Google sign-in"],
  ["PostHog id", "localStorage and cookie", "Counts visits", "Only after you accept"],
];

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-lg font-medium text-white">{children}</h2>;
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-white/40">
          <tr>{head.map((h) => <th key={h} className="py-1 pr-4 align-bottom font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-white/5 align-top">
              {r.map((c, i) => <td key={i} className="py-1.5 pr-4">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Email = () => <a className="underline" href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>;

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed text-white/65 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Privacy</h1>
        <p className="mt-2 text-xs text-white/35">Last updated {UPDATED}</p>

        <H>The short version</H>
        <p>Your audio never leaves your device. Transcription, stem splitting and slow-down all run inside your browser.
          Separated stems are cached in your browser&rsquo;s own storage, not on a server. We don&rsquo;t sell your data,
          don&rsquo;t use it to train models, and make no automated decisions that have legal effect on you.</p>

        <H>1. Who is responsible</H>
        {companyComplete() ? (
          <p>{COMPANY.legalName}, CVR {COMPANY.cvr}, {COMPANY.address}, Denmark. Privacy contact: <Email />. We are
            too small to need a data protection officer, so write to that address for anything privacy-related.</p>
        ) : (
          <p>Riffscribe is operated by 6x7. Privacy contact: <Email />. We are too small to need a data protection
            officer, so write to that address for anything privacy-related.</p>
        )}

        <H>2. What we process, why, and on what basis</H>
        <Table head={["Data", "Why", "Legal basis"]} rows={PROCESSING} />

        <H>The assistant</H>
        <p>The assistant is an AI system. When you ask it something, your message and a short description of what is open
          in the studio (instrument, tempo, key, never the audio) are sent to a language model to get a reply. The model
          is run by Anthropic, or by OpenRouter and the providers it routes to when the first is unavailable; OpenRouter
          is asked to skip providers that train on inputs. Signed in, the text of your chats is saved to your account so
          it follows you between devices; you can keep them on this device only, or not save them, in the
          assistant&rsquo;s settings.</p>

        <H>3. Who processes it</H>
        <Table head={["Provider", "Purpose", "Where", "Transfer outside the EU/EEA"]} rows={PROCESSORS} />
        <p className="mt-2">Magic-link sign-in emails are sent through our authentication provider (Supabase).</p>

        <H>4. Transfers outside the EU/EEA</H>
        <p>Where a provider is in the US we rely on the EU&ndash;US Data Privacy Framework where the provider is
          certified, and on the EU&rsquo;s standard contractual clauses otherwise. The table above says which.</p>

        <H>5. How long we keep it</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account and saved charts: until you delete them.</li>
          <li>Assistant chats: deleted after 12 months without use.</li>
          <li>Usage counts: 24 months.</li>
          <li>Payment webhook event ids: 30 days.</li>
          <li>Invoices and payment records at Stripe: 5 years, as bookkeeping law requires.</li>
          <li>Analytics (only if you accept): no longer than 12 months.</li>
        </ul>
        <p className="mt-2">Deleting your data from your <a className="underline" href="/account">account page</a> removes
          your saved songs, chats and the record that you used Riffscribe. It keeps your shared 6x7 login, which other
          6x7 apps use (email us to remove that too), and this month&rsquo;s count of assistant requests, so that deleting
          cannot reset your plan&rsquo;s allowance. That count goes when the login does.</p>

        <H>6. Your rights</H>
        <p>You can ask to access, correct, export or delete your data, to restrict or object to how we use it, and to
          withdraw consent at any time. Email <Email />; we answer within one month. You can also complain to{" "}
          {COMPANY.authority}.</p>

        <H>7. Cookies and local storage</H>
        <p>Only the first five items below are needed for the service to work, so they are used without asking. Analytics
          is the one thing that needs your consent, and it stays off until you accept. <CookieSettingsButton className="underline" /> reopens the choice.</p>
        <div className="mt-2">
          <Table head={["Item", "Where", "What for", "Consent"]} rows={STORAGE} />
        </div>

        <H>8. Changes</H>
        <p>If we change how we use your data in a way that matters, we tell you by email or in the app. The date at the
          top shows when this page was last updated.</p>
      </main>
      <SiteFooter />
    </>
  );
}
