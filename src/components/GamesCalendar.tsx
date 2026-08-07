import Link from "next/link";
import type { Game } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";

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

const DAY_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};

function dateKey(g: Game): string {
  return new Intl.DateTimeFormat("en-CA", {
    ...DAY_OPTS,
    timeZone: g.timezone ?? "UTC",
  }).format(new Date(g.kickoff_at));
}

// Month headers carry the year, so day headers don't need to — and a fan looking
// at an October game in August can see exactly what they're buying into.
function monthKey(g: Game): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: g.timezone ?? "UTC",
  }).format(new Date(g.kickoff_at));
}

// Same format, same venue timezone, applied to now: equal strings = same local
// day. Rendered server-side under a 15-minute revalidate, so the badge is never
// more than minutes stale — fine at day granularity.
function isToday(g: Game): boolean {
  return (
    dateKey(g) ===
    new Intl.DateTimeFormat("en-CA", {
      ...DAY_OPTS,
      timeZone: g.timezone ?? "UTC",
    }).format(new Date())
  );
}

// "TBD" is box-office shorthand (a cup tie awaiting its semifinal winner);
// "TBA" reads as plain English on a card.
function teamLabel(name: string | null): string | null {
  return name?.trim().toUpperCase() === "TBD" ? "TBA" : name;
}

// The shared calendar list, used by /games and /games/<competition>: games
// grouped by venue-local day, days grouped under month headers so a four-month
// list has scannable boundaries. Server component — nothing interactive.
export function GamesCalendar({ games }: { games: Game[] }) {
  if (games.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        No upcoming games on the calendar yet — it refreshes daily.
      </p>
    );
  }

  // Group by venue-local day, then gather days into months. Games arrive
  // kickoff-sorted, so both levels come out in order.
  const byDay = new Map<string, Game[]>();
  for (const g of games) {
    const key = dateKey(g);
    const day = byDay.get(key);
    if (day) day.push(g);
    else byDay.set(key, [g]);
  }
  const byMonth: { month: string; days: [string, Game[]][] }[] = [];
  for (const entry of byDay.entries()) {
    const month = monthKey(entry[1][0]);
    const last = byMonth[byMonth.length - 1];
    if (last && last.month === month) last.days.push(entry);
    else byMonth.push({ month, days: [entry] });
  }

  return (
    <div className="space-y-10">
      {byMonth.map(({ month, days }) => (
        <section key={month}>
          <h2 className="font-display font-black text-lg border-t-2 border-line pt-4">
            {month}
          </h2>
          {days.map(([day, dayGames]) => (
            <section key={day} className="mt-6">
              <h3 className="font-display font-bold text-sm uppercase tracking-widest text-pitch mb-3">
                {day}
                {isToday(dayGames[0]) && (
                  <span className="ml-2 rounded-full bg-bark px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-background align-middle">
                    Today
                  </span>
                )}
              </h3>
              <ol className="space-y-3">
                {dayGames.map((g) => {
                  const comp = tagBySlug(g.competition);
                  const home = teamLabel(g.home_team);
                  const away = teamLabel(g.away_team);
                  const matchup = home && away ? `${home} vs ${away}` : g.name;
                  const offsale = g.status === "offsale";
                  return (
                    <li key={g.id} className="rounded-lg border border-line bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted mb-1 flex items-center gap-2">
                            {comp && (
                              <Link
                                href={`/games/${comp.slug}`}
                                className="-mx-1.5 rounded px-1.5 py-1 font-semibold uppercase tracking-wide hover:text-pitch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
                              >
                                {comp.shortLabel ?? comp.label}
                              </Link>
                            )}
                            <span>·</span>
                            <time dateTime={new Date(g.kickoff_at).toISOString()}>
                              {kickoffLabel(g)}
                            </time>
                          </div>
                          <h4 className="font-display font-bold text-xl leading-snug">
                            {matchup}
                          </h4>
                          {(g.venue || g.city) && (
                            <p className="mt-1 text-sm text-muted">
                              {[g.venue, g.city, g.province].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                        {/* An offsale game gets an honest label instead of a buy
                            button that leads somewhere nothing can be bought —
                            still linked, since the box office page is where a
                            fan can watch for the onsale. */}
                        <a
                          href={g.ticket_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${offsale ? "Not on sale yet" : "Tickets"} — ${matchup}`}
                          className={
                            offsale
                              ? "shrink-0 rounded-full border border-line px-3 py-2 text-sm font-medium text-muted hover:border-pitch hover:text-pitch transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
                              : "shrink-0 rounded-full border border-pitch px-3 py-2 text-sm font-medium text-pitch hover:bg-pitch hover:text-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
                          }
                        >
                          {offsale ? "Not on sale yet" : "Tickets"} <span aria-hidden>↗</span>
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
