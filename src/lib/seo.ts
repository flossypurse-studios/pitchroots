import type { Game } from "@/lib/db";
import { alt as OG_IMAGE_ALT, size as OG_IMAGE_SIZE } from "@/app/opengraph-image";

// Next.js merges `metadata` per key, not deep. A segment that declares its own
// `openGraph` object REPLACES the parent's whole card rather than merging into
// it — only `title`/`description` ever backfill (from that segment's own plain
// `title`/`description`, and only when the segment's `openGraph` doesn't set
// them itself). `siteName`, `type`, `locale`, and `images` from the root layout
// vanish silently the moment a page adds a bare `openGraph: { url }`. So every
// route below that needs its own `openGraph.url` restates the whole card
// through this helper instead of a partial object.
export const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";
export const SITE_NAME = "PitchRoots";

/**
 * Full per-route OpenGraph card. Pass `image` for a route whose segment has no
 * `opengraph-image.tsx` of its own — currently that's everything except `/`
 * and `/news/[tag]`. A segment that DOES have its own file should omit
 * `image`: Next only auto-attaches the static file when the page's declared
 * `openGraph` has no `images` key at all, so passing one here would pre-empt
 * it and require restating the file's own alt text by hand.
 */
export function pageOpenGraph(opts: {
  title: string;
  description: string;
  path: string;
  image?: string;
}) {
  const { title, description, path, image } = opts;
  return {
    siteName: SITE_NAME,
    type: "website" as const,
    locale: "en_CA",
    url: path,
    title,
    description,
    // Full image object, not a bare URL string. A bare string resolves to
    // `{url}` alone, which drops og:image:width/height/alt — the same silent
    // subtraction this helper exists to prevent, one level down. Dimensions
    // and alt are imported from the image route itself so the two can't drift.
    ...(image
      ? {
          images: [
            {
              url: image,
              width: OG_IMAGE_SIZE.width,
              height: OG_IMAGE_SIZE.height,
              alt: OG_IMAGE_ALT,
            },
          ],
        }
      : {}),
  };
}

// SportsEvent JSON-LD, one per upcoming game — every field below comes
// straight off the row (`upcomingGames()` already excludes canceled/cancelled/
// postponed events, so `EventScheduled` is accurate for everything reaching
// this function). Deliberately omits `Offer.availability` and `.price`: the
// box office feed doesn't give us either, and guessing would be inventing
// facts.
export function sportsEventsJsonLd(games: Game[]) {
  return {
    "@context": "https://schema.org",
    "@graph": games.map((g) => {
      const location =
        g.venue || g.city || g.province
          ? {
              "@type": "Place",
              ...(g.venue ? { name: g.venue } : {}),
              ...(g.city || g.province
                ? {
                    address: {
                      "@type": "PostalAddress",
                      ...(g.city ? { addressLocality: g.city } : {}),
                      ...(g.province ? { addressRegion: g.province } : {}),
                      addressCountry: "CA",
                    },
                  }
                : {}),
            }
          : undefined;
      return {
        "@type": "SportsEvent",
        "@id": `${SITE}/games#game-${g.id}`,
        name:
          g.home_team && g.away_team ? `${g.home_team} vs ${g.away_team}` : g.name,
        sport: "Soccer",
        startDate: new Date(g.kickoff_at).toISOString(),
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        ...(location ? { location } : {}),
        ...(g.home_team ? { homeTeam: { "@type": "SportsTeam", name: g.home_team } } : {}),
        ...(g.away_team ? { awayTeam: { "@type": "SportsTeam", name: g.away_team } } : {}),
        offers: { "@type": "Offer", url: g.ticket_url },
      };
    }),
  };
}

export type Crumb = { name: string; path: string };

// BreadcrumbList JSON-LD — every field below is derived from the route's own
// real path/label, nothing invented.
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE}${c.path}`,
    })),
  };
}
