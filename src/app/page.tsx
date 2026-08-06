import type { Metadata } from "next";
import Link from "next/link";
import { hasUpcomingGames, latestItems, upcomingGames } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";

export const revalidate = 900;

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/feed.xml" },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "PitchRoots",
      description: "Canadian soccer news, one feed.",
      inLanguage: "en-CA",
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "PitchRoots",
      url: SITE,
      email: "hello@pitchroots.ca",
      logo: `${SITE}/opengraph-image`,
    },
  ],
};

const previewDateFmt = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

// The front door: one card per surface, the whole card a single link so the
// previews inside stay decoration rather than competing tap targets. The games
// card appears only once the calendar has games — same gate as the nav pill.
export default async function HomePage() {
  const [items, games] = await Promise.all([
    latestItems({ limit: 3 }),
    (async () => ((await hasUpcomingGames()) ? upcomingGames(3) : []))(),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <h1 className="font-display font-black text-2xl">
        What&apos;s happening in Canadian soccer
      </h1>
      <p className="mt-1 text-base text-muted">
        Curated headlines from across the country, and the games you can go see.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link
          href="/news"
          className="group rounded-lg border border-line bg-card p-5 hover:border-pitch transition-colors"
        >
          <h2 className="font-display font-bold text-xl group-hover:text-pitch transition-colors">
            News <span className="text-pitch">→</span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            The latest in Canadian soccer, updated hourly. Every story links to
            its source.
          </p>
          {items.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-line pt-3">
              {items.map((i) => (
                <li key={i.id} className="text-sm leading-snug">
                  <span className="font-semibold">{i.title}</span>{" "}
                  <span className="text-xs text-muted uppercase tracking-wide">
                    {i.source_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Link>
        {games.length > 0 && (
          <Link
            href="/games"
            className="group rounded-lg border border-line bg-card p-5 hover:border-pitch transition-colors"
          >
            <h2 className="font-display font-bold text-xl group-hover:text-pitch transition-colors">
              Games <span className="text-pitch">→</span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              Upcoming home games across the country — kickoff, venue, and
              tickets.
            </p>
            <ul className="mt-4 space-y-2 border-t border-line pt-3">
              {games.map((g) => {
                const comp = tagBySlug(g.competition);
                return (
                  <li key={g.id} className="text-sm leading-snug">
                    <span className="font-semibold">
                      {g.home_team && g.away_team
                        ? `${g.home_team} vs ${g.away_team}`
                        : g.name}
                    </span>{" "}
                    <span className="text-xs text-muted uppercase tracking-wide">
                      {previewDateFmt.format(new Date(g.kickoff_at))}
                      {comp ? ` · ${comp.shortLabel ?? comp.label}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Link>
        )}
      </div>
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        This site rebuilds itself with a durable workflow.{" "}
        <Link href="/how-it-works" className="hover:text-pitch underline">
          See how it&apos;s built →
        </Link>
      </p>
    </>
  );
}
