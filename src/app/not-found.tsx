import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

// Root not-found: covers notFound() from any segment and every unmatched URL.
// Renders inside the root layout, so the nav is right there as the way out.
export default function NotFound() {
  return (
    <article className="space-y-4 leading-relaxed">
      <p className="font-display font-black text-5xl text-pitch">404</p>
      <h1 className="font-display font-black text-2xl">Off the pitch</h1>
      <p>
        There&apos;s no page at this address. It may have moved, or the link may have a
        typo. Stories on PitchRoots always live with their original publisher — if you
        were following a story, the feed links straight to it.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/"
          className="rounded-full bg-pitch px-4 py-2 text-sm font-semibold text-background hover:bg-pitch-strong"
        >
          Back to the feed
        </Link>
        <Link
          href="/news"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:text-pitch"
        >
          All news
        </Link>
      </div>
    </article>
  );
}
