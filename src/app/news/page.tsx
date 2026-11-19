import type { Metadata } from "next";
import { latestItems } from "@/lib/db";
import { pageOpenGraph } from "@/lib/seo";
import { NewsView } from "./view";

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
  return <NewsView items={items} />;
}
