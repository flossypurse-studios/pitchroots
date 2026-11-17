import type { MetadataRoute } from "next";

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

// Search/answer crawlers and on-demand user fetchers we want indexing or
// citing pitchroots.ca. Mirrors the default "*" rule (allow "/", keep /api/
// out of it).
const ALLOWED_AI_AGENTS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "Applebot",
];

// AI-training / bulk-scraping crawlers we don't want harvesting the site.
const BLOCKED_AI_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "cohere-training-data-crawler",
  "Diffbot",
  "Omgilibot",
  "Amazonbot",
  "img2dataset",
  "FacebookBot",
  "AI2Bot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: ALLOWED_AI_AGENTS, allow: "/", disallow: "/api/" },
      { userAgent: BLOCKED_AI_AGENTS, disallow: "/" },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
