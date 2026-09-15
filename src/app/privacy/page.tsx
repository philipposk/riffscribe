// DRAFT — have a lawyer review before relying on it.
import SiteHeader, { SiteFooter } from "@/components/SiteHeader";

export const metadata = { title: "Privacy — Riffscribe" };

const UPDATED = "15 September 2026";

const PROCESSORS = [
  ["Supabase", "Accounts and saved charts", "EU"],
  ["Vercel", "Hosting", "EU / US"],
  ["OpenRouter", "The assistant's language model", "US"],
  ["Stripe", "Payments — we never see your card", "EU / US"],
  ["PostHog", "Page-view analytics, no session recording", "EU"],
  ["Google", "Sign-in, if you choose it", "EU / US"],
];

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-lg font-medium text-white">{children}</h2>;
}

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed text-white/65 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Privacy</h1>
        <p className="mt-2 text-xs text-white/35">Last updated {UPDATED}</p>

        <H>The short version</H>
        <p>Your audio never leaves your device. Transcription, stem splitting and slow-down all run inside your browser.
          Separated stems are cached in your browser&rsquo;s own storage, not on a server.</p>

        <H>What we keep</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Account:</b> your email address, from Google or an emailed sign-in link.</li>
          <li><b>Saved charts:</b> the notes, tempo, key, sections and title of songs you choose to save.</li>
          <li><b>Usage:</b> how many songs you have saved and how many assistant requests you made this month, to apply your plan&rsquo;s limits.</li>
          <li><b>Billing:</b> your plan and subscription status. Card details stay with Stripe.</li>
          <li><b>Analytics:</b> which pages are visited. No session recording, no automatic click capture, and signed-in people are identified by an id, not their email.</li>
        </ul>

        <H>The assistant</H>
        <p>When you ask the assistant something, your message and a short description of what is open in the studio
          (instrument, tempo, key — never the audio) are sent to a language model through OpenRouter to get a reply.
          Signed in, the text of your chats is saved to your account so it follows you between devices; you can keep
          them on this device only, or not save them, in the assistant&rsquo;s settings. Saved chats idle for 12 months
          are deleted.</p>

        <H>Who processes it</H>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/40"><tr><th className="py-1 pr-4 font-normal">Provider</th><th className="py-1 pr-4 font-normal">Purpose</th><th className="py-1 font-normal">Region</th></tr></thead>
            <tbody>
              {PROCESSORS.map(([n, p, r]) => (
                <tr key={n} className="border-t border-white/5"><td className="py-1.5 pr-4">{n}</td><td className="py-1.5 pr-4">{p}</td><td className="py-1.5">{r}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2">We don&rsquo;t sell your data or use it to train models.</p>

        <H>Deleting</H>
        <p>Delete a song from <a className="underline" href="/songs">My songs</a>, or everything from your{" "}
          <a className="underline" href="/account">account page</a>. The sign-in itself is shared with other 6x7 apps;
          email us to remove it too.</p>

        <H>Your rights</H>
        <p>Under GDPR and similar laws you can access, correct, export or delete your data, and object to processing.
          Email <a className="underline" href="mailto:phktistakis@gmail.com">phktistakis@gmail.com</a>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
