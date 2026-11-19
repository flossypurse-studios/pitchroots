import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { latestItems } from "@/lib/db";
import { parseShareId } from "@/lib/share";
import { sharedStoryMetadata } from "@/lib/seo";
import { sharedStory } from "@/lib/shared-story";
import { tagBySlug } from "@/lib/tags";
import { generateMetadata as hubMetadata } from "@/app/news/[tag]/page";
import { TagView } from "@/app/news/[tag]/view";

// Internal: /news/<tag>?s=<id> is rewritten here by src/proxy.ts (#561). Never
// linked and never in the sitemap; canonical is /news/<tag> and the page is
// noindex. ISR on first visit, like the shared /news variant.
export const revalidate = 900;

export function generateStaticParams() {
  return [];
}

// Same query and limit as the plain hub (hubItems in news/[tag]/page.tsx).
const hubItems = cache((tag: string) => latestItems({ tag, limit: 50 }));

type Props = { params: Promise<{ id: string; tag: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, tag } = await params;
  if (!tagBySlug(tag)) return {};
  const item = await sharedStory(id);
  if (!item) {
    const plain = await hubMetadata({ params: Promise.resolve({ tag }) });
    return { ...plain, robots: { index: false, follow: true } };
  }
  return sharedStoryMetadata({
    id: item.id,
    title: item.title,
    sourceName: item.source_name,
    path: `/news/${tag}`,
  });
}

export default async function SharedTagPage({ params }: Props) {
  const { id, tag } = await params;
  const def = tagBySlug(tag);
  if (!def || parseShareId(id) === null) notFound();
  const [item, items] = await Promise.all([sharedStory(id), hubItems(tag)]);
  return <TagView def={def} items={items} pinned={item} />;
}
