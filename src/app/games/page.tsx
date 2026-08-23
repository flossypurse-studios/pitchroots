import type { Metadata } from "next";
import { GamesCalendar } from "@/components/GamesCalendar";
import { upcomingGames } from "@/lib/db";
import { breadcrumbJsonLd, pageOpenGraph, sportsEventsJsonLd } from "@/lib/seo";

export const revalidate = 900;

const description =
  "Upcoming Canadian soccer games — CanMNT, CanWNT, MLS, CPL and NSL home dates across the country, with kickoff times, venues, and ticket links.";

// Same policy as an empty tag hub: a calendar with nothing in it is a thin page,
// so it stays out of the index until it has games to show. It starts indexing on
// its own the moment the sync lands data.
export async function generateMetadata(): Promise<Metadata> {
  const isEmpty = (await upcomingGames({ limit: 1 })).length === 0;
  return {
    title: "Games — upcoming Canadian soccer matches",
    description,
    alternates: { canonical: "/games" },
    ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
    // No opengraph-image.tsx exists for this segment, so unlike /news/[tag]
    // this one does need an explicit `image` — otherwise the whole card
    // (siteName/type/locale/images) gets replaced with nothing. See
    // src/lib/seo.ts.
    openGraph: pageOpenGraph({
      title: "Games — PitchRoots",
      description,
      path: "/games",
      image: "/opengraph-image",
    }),
  };
}

export default async function GamesPage() {
  const games = await upcomingGames();
  const breadcrumbs = breadcrumbJsonLd([
    { name: "PitchRoots", path: "/" },
    { name: "Games", path: "/games" },
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
        <h1 className="font-display font-black text-2xl">Games</h1>
        <p className="text-base text-muted mt-1">
          Upcoming Canadian home games — kickoff times are local to the venue, and
          every game links to tickets.
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
