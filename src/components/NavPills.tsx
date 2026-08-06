"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TAGS } from "@/lib/tags";

// text-background on the active pill keeps contrast in both themes: near-white
// on deep green in light mode, near-black on the brighter dark-mode green.
// `showGames` is decided server-side in the layout: the calendar pill exists
// only once the games table has something upcoming to show.
export function NavPills({ showGames = false }: { showGames?: boolean }) {
  const pathname = usePathname();
  const pill = (active: boolean) =>
    active
      ? "rounded-full border border-pitch bg-pitch px-3 py-1 font-medium text-background"
      : "rounded-full border border-line px-3 py-1 font-medium hover:border-pitch hover:text-pitch transition-colors";
  return (
    <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Leagues and competitions">
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
      {NAV_TAGS.map((t) => {
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
    </nav>
  );
}
