import type { MetadataRoute } from "next";

const SITE_URL = "https://riffscribe.6x7.gr";

/** AI crawlers named explicitly so letting them in is a stated choice. Same rules as "*". */
const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [AI_CRAWLERS, "*"].map((userAgent) => ({ userAgent, allow: "/", disallow: ["/api/", "/account"] })),
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
