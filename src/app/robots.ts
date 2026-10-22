import type { MetadataRoute } from "next";

const SITE_URL = "https://riffscribe.6x7.gr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
