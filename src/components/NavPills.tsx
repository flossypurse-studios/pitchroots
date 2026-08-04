"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TAGS } from "@/lib/tags";

// text-background on the active pill keeps contrast in both themes: near-white
// on deep green in light mode, near-black on the brighter dark-mode green.
export function NavPills() {
  const pathname = usePathname();
  return (
    <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Leagues and competitions">
      {NAV_TAGS.map((t) => {
        const active = pathname === `/${t.slug}`;
        return (
          <Link
            key={t.slug}
            href={`/${t.slug}`}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full border border-pitch bg-pitch px-3 py-1 font-medium text-background"
                : "rounded-full border border-line px-3 py-1 font-medium hover:border-pitch hover:text-pitch transition-colors"
            }
          >
            {t.shortLabel ?? t.label}
          </Link>
        );
      })}
    </nav>
  );
}
