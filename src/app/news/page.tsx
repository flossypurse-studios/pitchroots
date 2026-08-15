import type { Metadata } from "next";
import Link from "next/link";
import { Feed } from "@/components/Feed";
import { latestItems } from "@/lib/db";
import { breadcrumbJsonLd, pageOpenGraph } from "@/lib/seo";

export const revalidate = 900;

const description =
  "The latest in Canadian soccer — curated headlines from across the country, updated hourly, always linking to the source.";

export const metadata: Metadata = {
  title: "News",
  description,
  alternates: {
    canonical: "/news",
    types: { "application/rss+xml": "/feed.xml" },
  },
  // Was a bare { title, description, url } — that REPLACES the root layout's
  // openGraph object rather than merging into it, silently dropping
  // siteName/type/locale/images from every share of this page. See
  // src/lib/seo.ts.
  openGraph: pageOpenGraph({
    title: "News — PitchRoots",
    description,
    path: "/news",
    image: "/opengraph-image",
  }),
};

export default async function NewsPage() {
  const items = await latestItems({ limit: 100 });
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
      <Feed items={items} />
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        This feed rebuilds itself every hour with a durable workflow.{" "}
        <Link href="/how-it-works" className="hover:text-pitch underline">
          See how it&apos;s built →
        </Link>
      </p>
    </>
  );
}
