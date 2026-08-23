import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Feed } from "@/components/Feed";
import { latestItems } from "@/lib/db";
import { breadcrumbJsonLd, pageOpenGraph } from "@/lib/seo";
import { TAGS, tagBySlug } from "@/lib/tags";

export const revalidate = 900;
export const dynamicParams = false;

// generateMetadata needs the item count to decide on noindex, and the page needs
// the items themselves. React cache dedupes the two calls within one render pass,
// so this stays a single query per hub.
const hubItems = cache((tag: string) => latestItems({ tag, limit: 50 }));

export function generateStaticParams() {
  return TAGS.map((t) => ({ tag: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const def = tagBySlug(tag);
  if (!def) return {};
  const description = `${def.blurb} — curated Canadian soccer headlines, updated hourly, always linking to the source.`;
  // A hub with nothing in it is a thin page. Several province hubs have no source
  // covering them yet and render "Nothing here yet", so keep them out of the index
  // until they have something to show. They stay footer-linked and reachable, and
  // start indexing on their own the moment an item lands.
  const isEmpty = (await hubItems(tag)).length === 0;
  return {
    title: `${def.label} news`,
    description,
    alternates: { canonical: `/news/${tag}` },
    ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
    // No `image` here on purpose — this segment ships its own
    // opengraph-image.tsx (per-tag art), and passing an image would pre-empt
    // Next's static-file merge that attaches it. See src/lib/seo.ts.
    openGraph: pageOpenGraph({
      title: `${def.label} news — PitchRoots`,
      description,
      path: `/news/${tag}`,
    }),
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const def = tagBySlug(tag);
  if (!def) notFound();
  const items = await hubItems(tag);
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
      <Feed items={items} initial={items.length} />
    </>
  );
}
