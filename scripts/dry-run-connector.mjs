// Fetch a non-RSS source once, the way the poll function's fetchSource() does
// (same User-Agent, Accept header, 15s timeout), and print what its connector
// extracts. Read-only: no database, no model call, no link verification.
//
//   node scripts/dry-run-connector.mjs <connector> <feed_url> <home_url> [count]
//   node scripts/dry-run-connector.mjs forge 'https://dapi.cplsoccer.com/v2/content/en-us/stories?$limit=30' https://www.cplsoccer.com 5
import { CONNECTORS } from "../supabase/functions/poll/connectors.mjs";

const DEFAULT_UA = "Mozilla/5.0 (compatible; PitchRoots/1.0; +https://pitchroots.ca)";
const [kind, feedUrl, homeUrl, count = "5"] = process.argv.slice(2);
const connector = CONNECTORS[kind];
if (!connector || !feedUrl || !homeUrl) {
  console.error(`usage: dry-run-connector.mjs <${Object.keys(CONNECTORS).join("|")}> <feed_url> <home_url> [count]`);
  process.exit(2);
}

const res = await fetch(feedUrl, {
  headers: { "User-Agent": DEFAULT_UA, Accept: connector.accept },
  signal: AbortSignal.timeout(15_000),
  redirect: "follow",
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = connector.parse(await res.text(), homeUrl);
console.log(`${items.length} items from ${feedUrl}`);
for (const it of items.slice(0, Number(count))) {
  console.log(`\n${it.publishedAt}  ${it.title}\n  ${it.url}\n  ${it.snippet.slice(0, 140)}…`);
}
