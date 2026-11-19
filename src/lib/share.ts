// Share-a-story plumbing (#561). Pure functions only, no `@/` imports, so the
// proxy, the client button and the node:test suite can all load this file.
//
// A shared story is the page it was shared from plus `?s=<item id>`. There are
// no per-story pages: proxy.ts rewrites a valid `?s` on a feed page to the
// internal /shared/<id>/... route, which renders the same feed with that story
// pinned on top and story-specific og:* tags. The plain pages never read `s`,
// so they stay static/ISR exactly as before.

// Same rule as /api/social-card/[id]: digits only, no leading zero, at most nine
// digits (below 2^32, see that route for why). Anything else is not a share.
const ITEM_ID = /^[1-9][0-9]{0,8}$/;

export function parseShareId(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !ITEM_ID.test(raw)) return null;
  return Number(raw);
}

// The share URL for a story on a given feed page. `pageUrl` is the absolute
// URL of the plain page (no query); any query or hash on it is dropped so a
// share never carries along whatever else was in the address bar.
export function shareUrl(pageUrl: string, id: number): string {
  const u = new URL(pageUrl);
  u.search = "";
  u.hash = "";
  u.searchParams.set("s", String(id));
  return u.toString();
}

// Plain share-intent links, no scripts (owner's rule: no third-party SDKs,
// pixels or counters). Each opens the network's own compose page.
export function shareIntents(url: string, text: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return [
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "Bluesky", href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}` },
    { name: "X", href: `https://x.com/intent/tweet?text=${t}&url=${u}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  ];
}

// The proxy's whole decision, kept here so it can be tested without Next.
// Returns the internal path to rewrite to, or null to serve the plain page.
// Only the feed pages are eligible: /news and /news/<tag> (one segment, a
// known tag). The tag list is passed in so this file stays import-free.
export function pinnedRewritePath(
  pathname: string,
  rawShare: string | null,
  knownTags: readonly string[],
): string | null {
  const id = parseShareId(rawShare);
  if (id === null) return null;
  if (pathname === "/news" || pathname === "/news/") return `/shared/${id}/news`;
  const m = /^\/news\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (m && knownTags.includes(m[1])) return `/shared/${id}/news/${m[1]}`;
  return null;
}
