import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { latestItems } from "@/lib/db";
import { parseShareId } from "@/lib/share";
import { sharedStoryMetadata } from "@/lib/seo";
import { sharedStory } from "@/lib/shared-story";
import { metadata as newsMetadata } from "@/app/news/page";
import { NewsView } from "@/app/news/view";

// Internal: /news?s=<id> is rewritten here by src/proxy.ts (#561). Never linked
// and never in the sitemap; canonical is /news and the page is noindex.
// Rendered on first visit and cached like the feed (ISR), so a run of
// shared-link visits — or a walk through absent ids — is not a query per hit.
export const revalidate = 900;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await sharedStory(id);
  if (!item) return { ...newsMetadata, robots: { index: false, follow: true } };
  return sharedStoryMetadata({ id: item.id, title: item.title, sourceName: item.source_name, path: "/news" });
}

export default async function SharedNewsPage({ params }: Props) {
  const { id } = await params;
  if (parseShareId(id) === null) notFound();
  const [item, items] = await Promise.all([sharedStory(id), latestItems({ limit: 100 })]);
  return <NewsView items={items} pinned={item} />;
}
