// Non-RSS source connectors. Plain JS with no Deno or npm imports, so the Edge
// Function imports it and `node scripts/assert-connectors.mjs` can test it
// without a runtime.
//
// A connector turns one HTTP response body into the same raw item shape the RSS
// path builds: { guid, url, title, snippet, publishedAt }. index.ts adds the
// canonical URL and everything downstream (dedupe, verify, classify, publish) is
// unchanged. A source picks its connector with `sources.connector`.
//
// Each parser THROWS when it gets nothing usable out of a response. That is
// deliberately different from RSS, where an empty channel is a health signal
// (empty_streak) because a quiet feed is a normal thing. Here zero items means
// the response shape changed under us, so it must count as a failed fetch and
// go through the same retry → markSourceFail → auto-park path as an HTTP error.
// Never let it resolve as a quiet success.

import { decodeEntities } from "./entities.mjs";

const SNIPPET_MAX = 600;

// Forge stories tagged this are copies written for a club's own site. The
// league's /news page leaves them out (checked 2026-10-26: Pacific FC's
// "Josh Heard announces retirement…" is team-only, and the league ran its own
// version of the same story), so we leave them out too.
const FORGE_EXCLUDED_TAGS = new Set(["team-only"]);

function clean(s) {
  return typeof s === "string" ? decodeEntities(s).replace(/\s+/g, " ").trim() : "";
}

// Deltatre Forge content API (the "dapi." host behind cplsoccer.com, and behind
// whitecapsfc.com, torontofc.ca and cfmontreal.com). The site's own pages are
// rendered from it. Response: { items: [{ type, slug, title, headline, summary,
// contentDate, tags: [{ slug }] }], pagination, meta }. A story's public page is
// `<home_url>/news/<slug>`; the API carries no web URL of its own.
//
// guid is the slug-derived URL, the same value an RSS item's link-as-guid would
// be. `_entityId` is steadier, but a URL-shaped guid keeps alreadySeen() and the
// rejections table reading the same way they do for every other source.
export function parseForgeStories(body, homeUrl) {
  let doc;
  try {
    doc = typeof body === "string" ? JSON.parse(body) : body;
  } catch (err) {
    throw new Error(`source.malformedResponse: forge: response is not JSON (${err.message})`);
  }
  if (!doc || !Array.isArray(doc.items)) {
    throw new Error("source.malformedResponse: forge: response has no items array");
  }

  const out = [];
  for (const it of doc.items) {
    if (!it || it.type !== "story") continue;
    const tags = Array.isArray(it.tags) ? it.tags.map((t) => t && t.slug) : [];
    if (tags.some((t) => FORGE_EXCLUDED_TAGS.has(t))) continue;

    const slug = clean(it.slug);
    const title = clean(it.title);
    if (!slug || !title || !/^[a-z0-9-]+$/i.test(slug)) continue;

    const published = new Date(it.contentDate);
    if (!it.contentDate || Number.isNaN(published.getTime())) continue;

    const url = new URL(`/news/${slug}`, homeUrl).toString();
    // Opening text first: it is what same-story matching compares on (title +
    // opening text). The standfirst only stands in when there is no summary.
    const snippet = (clean(it.summary) || clean(it.headline)).slice(0, SNIPPET_MAX);

    out.push({ guid: url, url, title, snippet, publishedAt: published.toISOString() });
  }

  if (out.length === 0) {
    throw new Error(
      `source.noItems: forge: 0 usable stories out of ${doc.items.length} returned`,
    );
  }
  return out;
}

// connector name → { accept header, parser }. "rss" is handled by fetchFeed in
// index.ts and is not listed here.
export const CONNECTORS = {
  forge: { accept: "application/json", parse: parseForgeStories },
};
