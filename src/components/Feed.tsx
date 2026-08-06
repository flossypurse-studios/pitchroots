"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Edmonton",
});

// How many cards to show first, and how many to reveal per scroll. 10 fills a
// desktop viewport with a couple of cards of runway; a smaller first batch would
// under-fill the screen and trigger an immediate second load.
//
// This is the SSR count as well as the first-paint count: Next renders a client
// component with its initial state, and Googlebot executes JS but never scrolls, so
// the sentinel never fires for a crawler. Whatever `initial` is, that is all a
// crawler ever sees. The home feed keeps the progressive reveal; tag hubs — which
// are the site's entire SEO surface — pass their full length so nothing is hidden
// from the crawler behind a scroll event.
const INITIAL = 10;
const STEP = 10;

export function Feed({ items, initial = INITIAL }: { items: FeedItem[]; initial?: number }) {
  const [visible, setVisible] = useState(initial);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible >= items.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    // rootMargin pulls the trigger ~800px before the sentinel scrolls into view,
    // so the next batch is on the page before the reader reaches the end.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + STEP, items.length));
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, items.length]);

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        Nothing here yet — the feed updates every hour.
      </p>
    );
  }

  return (
    <>
      <ol className="space-y-4">
        {items.slice(0, visible).map((item) => (
          <li key={item.id} className="rounded-lg border border-line bg-card p-4">
            <div className="text-xs text-muted mb-1 flex items-center gap-2">
              <span className="font-semibold uppercase tracking-wide">{item.source_name}</span>
              <span>·</span>
              <time dateTime={new Date(item.published_at).toISOString()}>
                {dateFmt.format(new Date(item.published_at))} MT
              </time>
            </div>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <h2 className="font-display font-bold text-xl leading-snug hover:text-pitch transition-colors">
                {item.title}
                <span className="text-pitch"> ↗</span>
              </h2>
            </a>
            <p className="mt-1 text-sm leading-relaxed">{item.summary}</p>
            {item.also?.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                Also covered by{" "}
                {item.also.map((o, i) => (
                  <span key={o.url}>
                    {i > 0 && " · "}
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline hover:text-pitch transition-colors"
                    >
                      {o.name}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {item.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map((slug) => {
                  const def = tagBySlug(slug);
                  if (!def) return null;
                  return (
                    <Link
                      key={slug}
                      href={`/news/${slug}`}
                      className="text-xs text-muted rounded-full border border-line px-2 py-0.5 hover:border-pitch hover:text-pitch"
                    >
                      {def.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ol>
      {visible < items.length && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </>
  );
}
