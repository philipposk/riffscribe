import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { SiteJsonLd } from "@/components/SiteJsonLd";

const title = "Riffscribe — hear a song, get the score, tab and stems";
const description =
  "Drop in any song and get sheet music, guitar tab and MIDI. Mute the vocals, slow it down without changing the pitch, and record yourself over the top. All of it runs in your browser — nothing is uploaded.";

export const metadata: Metadata = {
  alternates: { canonical: "./" },
  robots: { index: true, follow: true },
  metadataBase: new URL("https://riffscribe.6x7.gr"),
  title,
  description,
  applicationName: "Riffscribe",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title,
    description,
    url: "https://riffscribe.6x7.gr",
    siteName: "Riffscribe",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Riffscribe" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteJsonLd />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
