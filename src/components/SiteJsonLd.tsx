/** Site-wide structured data (WebSite, Organization, SoftwareApplication) for search engines. */
const SITE_URL = "https://riffscribe.6x7.gr";
/** Must stay identical to the meta/OG description in app/layout.tsx. */
export const SITE_DESCRIPTION =
  "Drop in any song and get sheet music, guitar tab and MIDI. Mute the vocals, slow it down without changing the pitch, and record yourself over the top. All of it runs in your browser — nothing is uploaded.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Riffscribe",
      description: SITE_DESCRIPTION,
      publisher: { "@id": "https://6x7.gr/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "Organization",
      "@id": "https://6x7.gr/#organization",
      name: "6x7",
      url: "https://6x7.gr",
    },
    {
      "@type": ["SoftwareApplication", "WebApplication"],
      "@id": `${SITE_URL}/#app`,
      name: "Riffscribe",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      image: `${SITE_URL}/og-image.png`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      featureList: [
        "Audio to sheet music and tablature",
        "AI stem separation (vocals, drums, bass, other)",
        "Slow down without changing pitch, transpose, loop",
        "Record yourself over the backing track",
        "Export MIDI, MusicXML, PDF and WAV",
      ],
      publisher: { "@id": "https://6x7.gr/#organization" },
    },
  ],
};

export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // Escape "<" so the JSON can never close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}
