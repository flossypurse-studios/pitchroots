import { Feed } from "@/components/Feed";
import type { FeedItem } from "@/lib/db";
import { SITE, breadcrumbJsonLd } from "@/lib/seo";
import type { TagDef } from "@/lib/tags";

// The /news/<tag> body, shared by the plain hub and its shared-story variant
// (/news/<tag>?s=<id>, rewritten to /shared/<id>/news/<tag> by proxy.ts, #561).
export function TagView({
  def,
  items,
  pinned = null,
}: {
  def: TagDef;
  items: FeedItem[];
  pinned?: FeedItem | null;
}) {
  const tag = def.slug;
  const breadcrumbs = breadcrumbJsonLd([
    { name: "PitchRoots", path: "/" },
    { name: "News", path: "/news" },
    { name: `${def.label} news`, path: `/news/${tag}` },
  ]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}
      />
      <div className="mb-6">
        <h1 className="font-display font-black text-2xl">{def.label}</h1>
        <p className="text-base text-muted mt-1">{def.blurb}</p>
      </div>
      <Feed items={items} initial={items.length} pageUrl={`${SITE}/news/${tag}`} pinned={pinned} />
    </>
  );
}
