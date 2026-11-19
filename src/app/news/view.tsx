import Link from "next/link";
import { Feed } from "@/components/Feed";
import type { FeedItem } from "@/lib/db";
import { SITE, breadcrumbJsonLd } from "@/lib/seo";

// The /news body, shared by the plain page and its shared-story variant
// (/news?s=<id>, rewritten to /shared/<id>/news by proxy.ts, #561), so the two
// can never drift apart.
export function NewsView({ items, pinned = null }: { items: FeedItem[]; pinned?: FeedItem | null }) {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "PitchRoots", path: "/" },
    { name: "News", path: "/news" },
  ]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}
      />
      {/* Deliberately a small section label rather than a display heading: the
          card headlines are the page's real visual anchors, and the h1 exists to
          name the page for semantics and search, not to compete with them. */}
      <h1 className="font-display font-bold text-sm uppercase tracking-widest text-pitch mb-4">
        The latest in Canadian soccer
      </h1>
      <Feed items={items} pageUrl={`${SITE}/news`} pinned={pinned} />
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        This feed rebuilds itself every hour with a durable workflow.{" "}
        <Link href="/how-it-works" className="hover:text-pitch underline">
          See how it&apos;s built →
        </Link>
      </p>
    </>
  );
}
