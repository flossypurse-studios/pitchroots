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
import { freshEntries } from "../supabase/functions/poll/freshness.mjs";

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

// ── first-run cutoff (freshness.mjs) ──────────────────────────────────────────
// Fixed clock: the fixture's newest story is 2026-10-26T13:51Z.
const NOW = Date.parse("2026-10-26T18:00:00.000Z");
const H = 3_600_000;
const NB = new Date(NOW - 48 * H); // what the migration's now() - 48h stores
const at = (iso) => ({ guid: iso, url: `${HOME}/news/x`, title: "t", snippet: "s", publishedAt: iso });
const old = at("2026-10-23T12:00:00.000Z");      // 3 days old: inside 7d, before not_before
const recent = at("2026-10-26T09:00:00.000Z");   // 9h old
const edge = at(NB.toISOString());               // exactly on the cutoff: kept (>=)
const ancient = at("2026-10-10T00:00:00.000Z");  // older than the 7-day window
const pick = (xs, nb) => freshEntries(xs, NOW, 7, nb).map((e) => e.publishedAt);

// Old item skipped, recent kept, the boundary is inclusive.
assert.deepEqual(pick([recent, old, edge, ancient], NB), [recent.publishedAt, edge.publishedAt]);
// Replay-safe: the same instant read back from a checkpoint as an ISO string
// (or as postgres's text form) filters identically to the Date object.
assert.deepEqual(pick([recent, old, edge, ancient], NB.toISOString()), pick([recent, old, edge, ancient], NB));
assert.deepEqual(pick([recent, old], "2026-10-24 18:00:00+00"), [recent.publishedAt]);
// No cutoff (null/undefined, i.e. every RSS source) = exactly the old 7-day filter.
const oldBehaviour = (xs) => xs.filter((e) => Date.parse(e.publishedAt) >= NOW - 7 * 86_400_000);
for (const nb of [null, undefined]) {
  assert.deepEqual(pick([recent, old, edge, ancient], nb), oldBehaviour([recent, old, edge, ancient]).map((e) => e.publishedAt));
}
assert.deepEqual(pick([old], null), [old.publishedAt]);
// Not a permanent 48h max age: a week later (e.g. after a 3-day outage), a
// 3-day-old story is kept, because not_before is far behind the 7-day window.
assert.deepEqual(freshEntries([at("2026-10-30T18:00:00.000Z")], NOW + 7 * 24 * H, 7, NB).length, 1);
// A not_before older than the window never widens it.
assert.deepEqual(pick([ancient], new Date("2026-01-01T00:00:00Z")), []);
// Garbage is loud, not silently ignored.
assert.throws(() => freshEntries([recent], NOW, 7, "not a date"), /source\.badNotBefore/);
// The real CanPL response (6 stories, 10-25 19:43Z → 10-26 13:51Z): all six are
// inside 48h of NOW, and a cutoff landing mid-list keeps the newer four, in order.
const real = parseForgeStories(fixture("canpl-forge-stories-2026-10-26.json"), HOME);
assert.equal(freshEntries(real, NOW, 7, NB).length, 6);
assert.deepEqual(freshEntries(real, NOW, 7, "2026-10-25T22:15:00Z"), real.slice(0, 4));
assert.equal(freshEntries(real, NOW, 7, null).length, 6);

// ── registry ─────────────────────────────────────────────────────────────────
assert.equal(CONNECTORS.forge.parse, parseForgeStories);
assert.equal(CONNECTORS.forge.accept, "application/json");
assert.equal(CONNECTORS.rss, undefined); // RSS stays in index.ts's fetchFeed

console.log("connectors.mjs: all assertions passed");
