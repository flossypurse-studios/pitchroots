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

function dateKey(g: Game): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: g.timezone ?? "UTC",
  }).format(new Date(g.kickoff_at));
}

// The shared day-grouped calendar list, used by /games and /games/<competition>.
// Server component — everything is precomputed at render, nothing interactive.
export function GamesCalendar({ games }: { games: Game[] }) {
  if (games.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        No upcoming games on the calendar yet — it refreshes daily.
      </p>
    );
  }

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
                            href={`/games/${comp.slug}`}
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
  );
}
