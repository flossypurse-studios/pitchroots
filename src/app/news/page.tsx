import type { Metadata } from "next";
import Link from "next/link";
import { Feed } from "@/components/Feed";
import { latestItems } from "@/lib/db";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "News",
  description:
    "The latest in Canadian soccer — curated headlines from across the country, updated hourly, always linking to the source.",
  alternates: {
    canonical: "/news",
    types: { "application/rss+xml": "/feed.xml" },
  },
  openGraph: {
    title: "News — PitchRoots",
    description:
      "The latest in Canadian soccer — curated headlines, updated hourly, always linking to the source.",
    url: "/news",
  },
};

export default async function NewsPage() {
  const items = await latestItems({ limit: 100 });
  return (
    <>
      {/* Deliberately a small section label rather than a display heading: the
          card headlines are the page's real visual anchors, and the h1 exists to
          name the page for semantics and search, not to compete with them. */}
      <h1 className="font-display font-bold text-sm uppercase tracking-widest text-pitch mb-4">
        The latest in Canadian soccer
      </h1>
      <Feed items={items} />
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        This feed rebuilds itself every hour with a durable workflow.{" "}
        <Link href="/how-it-works" className="hover:text-pitch underline">
          See how it&apos;s built →
        </Link>
      </p>
    </>
  );
}
