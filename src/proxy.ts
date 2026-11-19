import { NextResponse, type NextRequest } from "next/server";
import { pinnedRewritePath } from "@/lib/share";
import { TAG_SLUGS } from "@/lib/tags";

// Shared-story links (#561): `/news?s=123` and `/news/<tag>?s=123` render the
// same feed with story 123 pinned on top, via a rewrite to the internal
// /shared/... route. The address bar keeps the URL that was shared.
//
// Rewriting here, rather than reading searchParams in the feed pages, is what
// keeps /news and /news/<tag> static/ISR: a page that reads searchParams opts
// out of caching and every visit would hit the database.
//
// The matcher is deliberately narrow: only the feed pages, and only when an `s`
// query parameter is present. /api, static assets and every other route never
// reach this function. An invalid id falls through to the plain page.
export function proxy(request: NextRequest) {
  const to = pinnedRewritePath(
    request.nextUrl.pathname,
    request.nextUrl.searchParams.get("s"),
    TAG_SLUGS,
  );
  if (!to) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    { source: "/news", has: [{ type: "query", key: "s" }] },
    { source: "/news/:tag", has: [{ type: "query", key: "s" }] },
  ],
};
