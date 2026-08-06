import type { Metadata } from "next";
import Link from "next/link";
import { upcomingGames, type Game } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";

export const revalidate = 900;

const description =
  "Upcoming Canadian soccer games — CanMNT, CanWNT, MLS, CPL and NSL home dates across the country, with kickoff times, venues, and ticket links.";

// Same policy as an empty tag hub: a calendar with nothing in it is a thin page,
// so it stays out of the index until it has games to show. It starts indexing on
// its own the moment the sync lands data.
export async function generateMetadata(): Promise<Metadata> {
  const isEmpty = (await upcomingGames(1)).length === 0;
  return {
    title: "Games — upcoming Canadian soccer matches",
    description,
    alternates: { canonical: "/games" },
    ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: "Games — PitchRoots",
      description,
      url: "/games",
    },
  };
}

// Kickoff renders in the venue's own timezone — a national calendar shows a
// Halifax game in AT and a Vancouver game in PT, because that's when the gates
// open for the person deciding whether to go.
function kickoffLabel(g: Game): string {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: g.timezone ?? "UTC",
    timeZoneName: "short",
  }).format(new Date(g.kickoff_at));
}

function dateKey(g: Game): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: g.timezone ?? "UTC",
  }).format(new Date(g.kickoff_at));
}

export default async function GamesPage() {
  const games = await upcomingGames();

  // Group by venue-local calendar day. Games arrive kickoff-sorted, so days come
  // out in order too.
  const byDay = new Map<string, Game[]>();
  for (const g of games) {
    const key = dateKey(g);
    const day = byDay.get(key);
    if (day) day.push(g);
    else byDay.set(key, [g]);
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display font-black text-2xl">Games</h1>
        <p className="text-base text-muted mt-1">
          Upcoming Canadian home games — kickoff times are local to the venue, and
          every game links to tickets.
        </p>
      </div>
      {games.length === 0 ? (
        <p className="py-12 text-center text-muted">
          No upcoming games on the calendar yet — it refreshes daily.
        </p>
      ) : (
        <div className="space-y-8">
          {[...byDay.entries()].map(([day, dayGames]) => (
            <section key={day}>
              <h2 className="font-display font-bold text-sm uppercase tracking-widest text-pitch mb-3">
                {day}
              </h2>
              <ol className="space-y-3">
                {dayGames.map((g) => {
                  const comp = tagBySlug(g.competition);
                  return (
                    <li key={g.id} className="rounded-lg border border-line bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted mb-1 flex items-center gap-2">
                            {comp && (
                              <Link
                                href={`/news/${comp.slug}`}
                                className="font-semibold uppercase tracking-wide hover:text-pitch"
                              >
                                {comp.shortLabel ?? comp.label}
                              </Link>
                            )}
                            <span>·</span>
                            <time dateTime={new Date(g.kickoff_at).toISOString()}>
                              {kickoffLabel(g)}
                            </time>
                          </div>
                          <h3 className="font-display font-bold text-xl leading-snug">
                            {g.home_team && g.away_team
                              ? `${g.home_team} vs ${g.away_team}`
                              : g.name}
                          </h3>
                          {(g.venue || g.city) && (
                            <p className="mt-1 text-sm text-muted">
                              {[g.venue, g.city, g.province].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                        <a
                          href={g.ticket_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-full border border-pitch px-3 py-1 text-sm font-medium text-pitch hover:bg-pitch hover:text-background transition-colors"
                        >
                          Tickets <span aria-hidden>↗</span>
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        Schedule and ticket links sync daily from the box office. Kickoff times can
        change — the ticket page is authoritative.
      </p>
    </>
  );
}
