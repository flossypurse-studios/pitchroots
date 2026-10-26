// Script-level check for supabase/functions/poll/connectors.mjs, in the same
// style as assert-entities.mjs (this repo has no test runner configured):
// `node scripts/assert-connectors.mjs`.
//
// The fixtures are real responses from the CPL's Forge content API, saved
// 2026-10-26 with the poll function's own User-Agent:
//   canpl-forge-stories-2026-10-26.json            stories?$limit=6
//   canpl-forge-stories-team-only-2026-10-26.json  stories?$limit=3&$skip=17
// Each item is cut down to the fields the parser reads (type, slug, title,
// headline, summary, contentDate, tag slugs). The full response also names the
// league's CMS editors and carries internal ids, which don't belong in a public
// repo. Values are unedited.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseForgeStories, CONNECTORS } from "../supabase/functions/poll/connectors.mjs";

const HOME = "https://www.cplsoccer.com";
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// ── the real response ─────────────────────────────────────────────────────────
const items = parseForgeStories(fixture("canpl-forge-stories-2026-10-26.json"), HOME);
assert.equal(items.length, 6);
for (const it of items) {
  // Exactly the raw shape fetchFeed builds for an RSS item (index.ts adds canonicalUrl).
  assert.deepEqual(Object.keys(it).sort(), ["guid", "publishedAt", "snippet", "title", "url"]);
  assert.match(it.url, /^https:\/\/www\.cplsoccer\.com\/news\/[a-z0-9-]+$/);
  assert.equal(it.guid, it.url);
  assert.equal(new Date(it.publishedAt).toISOString(), it.publishedAt);
  assert.ok(it.title.length > 0 && it.title === it.title.trim());
  assert.ok(it.snippet.length > 0 && it.snippet.length <= 600);
  assert.ok(!it.snippet.includes("\n"));
}
// The API's own title carries a leading space; it must not reach the card.
assert.equal(items[0].title, "'Table never lies': Cavalry claim 2026 CPL Shield after remarkable season");
assert.equal(items[0].url, `${HOME}/news/table-never-lies-cavalry-claim-2026-cpl-shield-after-remarkable-season`);
assert.equal(items[0].publishedAt, "2026-10-26T13:51:14.023Z");
assert.ok(items[0].snippet.startsWith("Tommy Wheeldon Jr. raised his voice"));
// Newest first, as the API returns them (ingestSource takes the first 12).
assert.ok(items[0].publishedAt >= items[5].publishedAt);
// A home_url with a trailing slash or path still builds the same article URL.
assert.equal(parseForgeStories(fixture("canpl-forge-stories-2026-10-26.json"), `${HOME}/news`)[0].url, items[0].url);

// ── team-only copies are left out, as the league's own /news page does ────────
const mixed = parseForgeStories(fixture("canpl-forge-stories-team-only-2026-10-26.json"), HOME);
assert.deepEqual(mixed.map((i) => i.url), [`${HOME}/news/pacific-fc-captain-josh-heard-announces-retirement`]);

// ── zero usable items is a FAILURE, never a quiet success ─────────────────────
const story = (over = {}) => ({
  type: "story", slug: "a-story", title: "A story", summary: "Opening text.",
  contentDate: "2026-10-26T12:00:00.000Z", tags: [], ...over,
});
assert.throws(() => parseForgeStories(JSON.stringify({ items: [] }), HOME), /^Error: source\.noItems: /);
assert.throws(
  () => parseForgeStories(JSON.stringify({ items: [story({ tags: [{ slug: "team-only" }] })] }), HOME),
  /source\.noItems: forge: 0 usable stories out of 1 returned/,
);
assert.throws(() => parseForgeStories("<!doctype html><html>moved</html>", HOME), /^Error: source\.malformedResponse: forge: response is not JSON/);
assert.throws(() => parseForgeStories(JSON.stringify({ stories: [story()] }), HOME), /source\.malformedResponse: forge: response has no items array/);
assert.throws(() => parseForgeStories("null", HOME), /source\.malformedResponse/);

// ── item-level skips: anything we can't link, title or date is dropped ────────
const kept = parseForgeStories(JSON.stringify({
  items: [
    story({ slug: "kept" }),
    story({ slug: "video-thing", type: "video" }),
    story({ slug: "" }),
    story({ slug: "../../etc/passwd" }),
    story({ slug: "no-title", title: "   " }),
    story({ slug: "bad-date", contentDate: "not a date" }),
    story({ slug: "no-date", contentDate: undefined }),
    null,
  ],
}), HOME);
assert.deepEqual(kept.map((i) => i.url), [`${HOME}/news/kept`]);

// ── text cleanup ──────────────────────────────────────────────────────────────
const [decoded] = parseForgeStories(JSON.stringify({
  items: [story({ title: "CF Montr&#xe9;al &amp; Forge", summary: "Line one.\nLine two." })],
}), HOME);
assert.equal(decoded.title, "CF Montréal & Forge");
assert.equal(decoded.snippet, "Line one. Line two.");
// No summary → the standfirst stands in; long text is cut at 600.
assert.equal(parseForgeStories(JSON.stringify({ items: [story({ summary: "", headline: "Standfirst" })] }), HOME)[0].snippet, "Standfirst");
assert.equal(parseForgeStories(JSON.stringify({ items: [story({ summary: "x".repeat(900) })] }), HOME)[0].snippet.length, 600);

// ── registry ─────────────────────────────────────────────────────────────────
assert.equal(CONNECTORS.forge.parse, parseForgeStories);
assert.equal(CONNECTORS.forge.accept, "application/json");
assert.equal(CONNECTORS.rss, undefined); // RSS stays in index.ts's fetchFeed

console.log("connectors.mjs: all assertions passed");
