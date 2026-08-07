"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GAME_TAGS, NAV_TAGS } from "@/lib/tags";

// text-background on the active pill keeps contrast in both themes: near-white
// on deep green in light mode, near-black on the brighter dark-mode green.
//
// The nav is surface-aware: the two root pills (News, Games) are always there,
// but tag pills belong to their surface — news tags on /news and /news/<tag>,
// game-competition tags on /games and /games/<competition>, and neither set on
// the landing or site-level pages, where the roots are the whole story.
// `gameCompetitions` is decided server-side in the layout: only competitions
// that currently have upcoming games get a pill, so no pill ever leads to an
// empty page. An empty array also hides the Games root pill (calendar not yet
// populated).
export function NavPills({ gameCompetitions = [] }: { gameCompetitions?: string[] }) {
  const pathname = usePathname();
  const pill = (active: boolean) =>
    active
      ? "rounded-full border border-pitch bg-pitch px-3 py-1 font-medium text-background"
      : "rounded-full border border-line px-3 py-1 font-medium hover:border-pitch hover:text-pitch transition-colors";

  const onNews = pathname === "/news" || pathname.startsWith("/news/");
  const onGames = pathname === "/games" || pathname.startsWith("/games/");
  const showGames = gameCompetitions.length > 0;

  return (
    <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Sections">
      <Link
        href="/news"
        aria-current={pathname === "/news" ? "page" : undefined}
        className={pill(pathname === "/news")}
      >
        News
      </Link>
      {showGames && (
        <Link
          href="/games"
          aria-current={pathname === "/games" ? "page" : undefined}
          className={pill(pathname === "/games")}
        >
          Games
        </Link>
      )}
      {onNews &&
        NAV_TAGS.map((t) => {
          const active = pathname === `/news/${t.slug}`;
          return (
            <Link
              key={t.slug}
              href={`/news/${t.slug}`}
              aria-current={active ? "page" : undefined}
              className={pill(active)}
            >
              {t.shortLabel ?? t.label}
            </Link>
          );
        })}
      {onGames &&
        GAME_TAGS.filter((t) => gameCompetitions.includes(t.slug)).map((t) => {
          const active = pathname === `/games/${t.slug}`;
          return (
            <Link
              key={t.slug}
              href={`/games/${t.slug}`}
              aria-current={active ? "page" : undefined}
              className={pill(active)}
            >
              {t.shortLabel ?? t.label}
            </Link>
          );
        })}
    </nav>
  );
}
