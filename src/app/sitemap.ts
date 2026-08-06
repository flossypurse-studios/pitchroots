import type { MetadataRoute } from "next";
import { hasUpcomingGames, sql } from "@/lib/db";
import { TAGS } from "@/lib/tags";

export const revalidate = 3600;

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const q = sql();
  const rows = (await q`
    select t.tag, max(i.published_at) as last
    from items i, unnest(i.tags) as t(tag)
    group by t.tag`) as { tag: string; last: string }[];
  const lastByTag = new Map(rows.map((r) => [r.tag, new Date(r.last)]));
  const [overall] = (await q`select max(published_at) as last from items`) as { last: string | null }[];
  const home = overall?.last ? new Date(overall.last) : new Date();

  return [
    { url: SITE, lastModified: home, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE}/how-it-works`, changeFrequency: "monthly", priority: 0.3 },
    // Same rule as empty tag hubs: the calendar joins the sitemap only once it
    // has upcoming games (until then the page is noindexed and unlinked).
    ...((await hasUpcomingGames())
      ? [{ url: `${SITE}/games`, changeFrequency: "daily" as const, priority: 0.7 }]
      : []),
    // Only submit hubs that actually have items. `lastByTag` is built from a query
    // grouped over existing items, so an empty hub is simply absent from it. Before
    // this filter, empty hubs were not only listed but stamped with the whole feed's
    // latest timestamp — telling Google a content-free page had just been updated.
    ...TAGS.filter((t) => lastByTag.has(t.slug)).map((t) => ({
      url: `${SITE}/${t.slug}`,
      lastModified: lastByTag.get(t.slug) ?? home,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
  ];
}
