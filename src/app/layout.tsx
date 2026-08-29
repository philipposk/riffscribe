import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Riffscribe — hear a song, get the score, tab and stems";
const description =
  "Drop in any song and get sheet music, guitar tab and MIDI. Mute the vocals, slow it down without changing the pitch, and record yourself over the top. All of it runs in your browser — nothing is uploaded.";

export const metadata: Metadata = {
  metadataBase: new URL("https://riff.6x7.gr"),
  title,
  description,
  applicationName: "Riffscribe",
  openGraph: { title, description, url: "https://riff.6x7.gr", siteName: "Riffscribe", type: "website" },
  twitter: { card: "summary_large_image", title, description },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
