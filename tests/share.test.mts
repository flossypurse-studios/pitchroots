// Share-a-story plumbing (#561): id validation, share URLs, intent links and the
// proxy's rewrite decision. The proxy itself is a thin wrapper over
// pinnedRewritePath; its matcher is checked from source below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseShareId, pinnedRewritePath, shareIntents, shareUrl } from "../src/lib/share.ts";

const TAGS = ["canpl", "world-cup", "alberta"];

test("share ids follow the social-card rule: 1-9 digits, no leading zero", () => {
  assert.equal(parseShareId("1"), 1);
  assert.equal(parseShareId("123456789"), 123456789);
  for (const bad of [null, undefined, "", "0", "01", "1234567890", "12a", "-1", "1.5", " 12", "12 ", "1e3", "0x10", "١٢"]) {
    assert.equal(parseShareId(bad as string | null), null, `rejects ${JSON.stringify(bad)}`);
  }
});

test("the card route and the share parser use the same id pattern", () => {
  const route = readFileSync(new URL("../src/app/api/social-card/[id]/route.ts", import.meta.url), "utf8");
  const share = readFileSync(new URL("../src/lib/share.ts", import.meta.url), "utf8");
  assert.ok(route.includes("/^[1-9][0-9]{0,8}$/"));
  assert.ok(share.includes("/^[1-9][0-9]{0,8}$/"));
});

test("a share URL is the plain page plus ?s=<id>, dropping any other query or hash", () => {
  assert.equal(shareUrl("https://pitchroots.ca/news", 42), "https://pitchroots.ca/news?s=42");
  assert.equal(shareUrl("https://pitchroots.ca/news/canpl", 7), "https://pitchroots.ca/news/canpl?s=7");
  assert.equal(shareUrl("https://pitchroots.ca/news/canpl?s=1&utm=x#top", 7), "https://pitchroots.ca/news/canpl?s=7");
});

test("intent links are plain https URLs on the networks' own domains, with the URL encoded", () => {
  const url = "https://pitchroots.ca/news?s=42";
  const intents = shareIntents(url, "Forge & Cavalry: 2–1");
  assert.deepEqual(intents.map((i) => i.name), ["Facebook", "Bluesky", "X", "LinkedIn"]);
  const hosts = intents.map((i) => new URL(i.href).host);
  assert.deepEqual(hosts, ["www.facebook.com", "bsky.app", "x.com", "www.linkedin.com"]);
  for (const i of intents) {
    const params = [...new URL(i.href).searchParams.values()].join(" ");
    assert.ok(params.includes(url), `${i.name} carries the share URL`);
  }
  // `&` in the headline must not split the query string.
  assert.equal(new URL(intents[2].href).searchParams.get("text"), "Forge & Cavalry: 2–1");
});

test("the proxy rewrites only feed pages with a valid id", () => {
  assert.equal(pinnedRewritePath("/news", "42", TAGS), "/shared/42/news");
  assert.equal(pinnedRewritePath("/news/canpl", "42", TAGS), "/shared/42/news/canpl");
  assert.equal(pinnedRewritePath("/news/world-cup", "9", TAGS), "/shared/9/news/world-cup");
  // Invalid ids: the plain page.
  assert.equal(pinnedRewritePath("/news", "abc", TAGS), null);
  assert.equal(pinnedRewritePath("/news", "0", TAGS), null);
  assert.equal(pinnedRewritePath("/news", "1234567890", TAGS), null);
  assert.equal(pinnedRewritePath("/news", null, TAGS), null);
  // Unknown tags and other routes: never rewritten.
  assert.equal(pinnedRewritePath("/news/hockey", "42", TAGS), null);
  assert.equal(pinnedRewritePath("/news/canpl/x", "42", TAGS), null);
  assert.equal(pinnedRewritePath("/", "42", TAGS), null);
  assert.equal(pinnedRewritePath("/api/social-card/42", "42", TAGS), null);
  assert.equal(pinnedRewritePath("/games", "42", TAGS), null);
  assert.equal(pinnedRewritePath("/shared/42/news", "42", TAGS), null);
});

test("the proxy matcher is narrow: only /news and /news/:tag, only with ?s", () => {
  const src = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const matcher = src.slice(src.indexOf("matcher:"));
  const sources = [...matcher.matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sources, ["/news", "/news/:tag"]);
  assert.equal((matcher.match(/has:\s*\[\{\s*type:\s*"query",\s*key:\s*"s"\s*\}\]/g) ?? []).length, 2);
});

test("the plain feed pages never read searchParams (they must stay static/ISR)", () => {
  for (const f of ["../src/app/news/page.tsx", "../src/app/news/[tag]/page.tsx", "../src/app/page.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!src.includes("searchParams"), `${f} reads searchParams`);
  }
});
