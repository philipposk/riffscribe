import Link from "next/link";
import { Music2 } from "lucide-react";

import AccountMenu from "./AccountMenu";
import { CookieSettingsButton } from "./ConsentBanner";
import { COMPANY, companyLine } from "@/lib/company";

/** The bar on every page outside the studio. */
export default function SiteHeader() {
  return (
    <header className="no-print mx-auto flex max-w-5xl items-center gap-4 px-5 pt-6 sm:px-8">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <Music2 className="text-[var(--color-accent)]" size={18} /> Riffscribe
      </Link>
      <nav className="ml-auto flex items-center gap-4 text-sm text-white/55">
        <Link className="hover:text-white" href="/pricing">Pricing</Link>
        <a className="hover:text-white" href="/studio">Studio</a>
        <AccountMenu />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const identity = companyLine();
  return (
    <footer className="no-print mx-auto mt-16 max-w-5xl px-5 pb-10 text-xs text-faint sm:px-8">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Link className="hover:text-white/60" href="/pricing">Pricing</Link>
        <Link className="hover:text-white/60" href="/terms">Terms</Link>
        <Link className="hover:text-white/60" href="/privacy">Privacy</Link>
        <a className="hover:text-white/60" href={`mailto:${COMPANY.contactEmail}`}>Contact</a>
        <CookieSettingsButton className="hover:text-white/60" />
        <a className="hover:text-white/60" href="https://github.com/philipposk/riffscribe">GitHub</a>
        <span className="ml-auto">Part of <a className="underline" href="https://6x7.gr">6x7.gr</a></span>
      </div>
      {identity && <p className="mt-3">{identity}</p>}
    </footer>
  );
}
