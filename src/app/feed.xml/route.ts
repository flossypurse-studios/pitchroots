import { latestItems } from "@/lib/db";

export const revalidate = 900;

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  const items = await latestItems({ limit: 50 });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>PitchRoots — Canadian soccer, one feed</title>
<link>${SITE}/news</link>
<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
<description>Curated Canadian soccer headlines. Every item links to the original publisher.</description>
<language>en-ca</language>
${items
  .map(
    (i) => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.url)}</link>
<guid isPermaLink="false">${esc(i.url)}</guid>
<pubDate>${new Date(i.published_at).toUTCString()}</pubDate>
<description>${esc(`${i.summary} (via ${i.source_name})`)}</description>
</item>`,
  )
  .join("\n")}
</channel>
</rss>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
