import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GamesCalendar } from "@/components/GamesCalendar";
import { upcomingGames } from "@/lib/db";
import { breadcrumbJsonLd, pageOpenGraph, sportsEventsJsonLd } from "@/lib/seo";
import { GAME_TAGS, GAME_TAG_SLUGS, tagBySlug } from "@/lib/tags";

export const revalidate = 900;
export const dynamicParams = false;

// generateMetadata needs the games to decide on noindex, and the page needs them
// to render. React cache dedupes the two calls within one render pass.
const competitionGames = cache((competition: string) => upcomingGames({ competition }));

export function generateStaticParams() {
  return GAME_TAG_SLUGS.map((competition) => ({ competition }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competition: string }>;
}): Promise<Metadata> {
  const { competition } = await params;
  const def = tagBySlug(competition);
  if (!def) return {};
  const description = `Upcoming ${def.label} games — home dates with kickoff times, venues, and ticket links.`;
  // A competition with no upcoming games is a thin page; keep it out of the
  // index until the calendar has dates for it. Nothing links here until then.
  const isEmpty = (await competitionGames(competition)).length === 0;
  return {
    title: `${def.label} games & tickets`,
    description,
    alternates: { canonical: `/games/${competition}` },
    ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
    // No opengraph-image.tsx for this segment — needs an explicit `image` or
    // the whole card gets replaced with nothing. See src/lib/seo.ts.
    openGraph: pageOpenGraph({
      title: `${def.label} games — PitchRoots`,
      description,
      path: `/games/${competition}`,
      image: "/opengraph-image",
    }),
  };
}

export default async function CompetitionGamesPage({
  params,
}: {
  params: Promise<{ competition: string }>;
}) {
  const { competition } = await params;
  const def = GAME_TAGS.find((t) => t.slug === competition);
  if (!def) notFound();
  const games = await competitionGames(competition);
  const breadcrumbs = breadcrumbJsonLd([
    { name: "PitchRoots", path: "/" },
    { name: "Games", path: "/games" },
    { name: `${def.label} games`, path: `/games/${competition}` },
  ]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}
      />
      {games.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(sportsEventsJsonLd(games)).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <div className="mb-6">
        <h1 className="font-display font-black text-2xl">{def.label} games</h1>
        <p className="text-base text-muted mt-1">
          {def.blurb} — upcoming home dates, kickoff times local to the venue.
        </p>
      </div>
      <GamesCalendar games={games} />
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        Schedule and ticket links sync daily from the box office. Kickoff times can
        change — the ticket page is authoritative.
      </p>
    </>
  );
}
