"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";
import { edmontonFormat } from "@/lib/edmontonZone";
import { shareUrl } from "@/lib/share";
import { SourceLogo } from "./SourceLogo";
import { ShareButton, SharePanel } from "./Share";

const dateFmt = edmontonFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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

export function Feed({
  items,
  initial = INITIAL,
  pageUrl,
  pinned = null,
}: {
  items: FeedItem[];
  initial?: number;
  // Absolute URL of the plain page this feed is on; a story's share link is
  // this plus `?s=<id>` (#561).
  pageUrl: string;
  // A shared story (`?s=<id>`), shown first and highlighted. Never repeated
  // in the list below it.
  pinned?: FeedItem | null;
}) {
  const [visible, setVisible] = useState(initial);
  const [shareOpen, setShareOpen] = useState<number | null>(null);
  const list = pinned ? items.filter((i) => i.id !== pinned.id) : items;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible >= list.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    // rootMargin pulls the trigger ~800px before the sentinel scrolls into view,
    // so the next batch is on the page before the reader reaches the end.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + STEP, list.length));
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, list.length]);

  if (list.length === 0 && !pinned) {
    return (
      <p className="py-12 text-center text-muted">
        Nothing here yet — the feed updates every hour.
      </p>
    );
  }

  // One story card. The pinned story is the same card, highlighted, with a
  // plain "Read it at <Source>" link under it.
  const story = (item: FeedItem, isPinned: boolean) => {
    const url = shareUrl(pageUrl, item.id);
    const panelId = `share-${item.id}`;
    const open = shareOpen === item.id;
    return (
      <li
        key={item.id}
        className={
          isPinned
            ? "rounded-lg border-2 border-pitch bg-card p-4"
            : "rounded-lg border border-line bg-card p-4"
        }
      >
        {isPinned && (
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-pitch">Shared with you</p>
        )}
        {/* The Share button sits beside the source line and wraps under it
            rather than overlapping it when large text makes the two not fit;
            the headline below keeps the card's full width either way. */}
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-min flex-1 basis-0 text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1.5">
              <SourceLogo name={item.source_name} />
              <span className="font-semibold uppercase tracking-wide">{item.source_name}</span>
            </span>
            <span>·</span>
            <time dateTime={new Date(item.published_at).toISOString()}>
              {dateFmt.format(new Date(item.published_at))}
            </time>
          </div>
          <ShareButton
            url={url}
            title={item.title}
            panelId={panelId}
            open={open}
            onToggle={() => setShareOpen(open ? null : item.id)}
          />
        </div>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <h2 className="font-display font-bold text-xl leading-snug hover:text-pitch transition-colors">
            {item.title}
            <span className="text-pitch" aria-hidden> ↗</span>
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
                  className="inline-flex items-center gap-1 align-middle font-semibold text-bark underline hover:text-pitch transition-colors"
                >
                  <SourceLogo name={o.name} size={14} />
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
        {isPinned && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-background hover:bg-pitch-strong transition-colors"
          >
            Read it at {item.source_name} <span aria-hidden>&nbsp;↗</span>
          </a>
        )}
        {open && <SharePanel id={panelId} url={url} title={item.title} />}
      </li>
    );
  };

  return (
    <>
      {pinned && <ol className="mb-6">{story(pinned, true)}</ol>}
      <ol className="space-y-4">
        {list.slice(0, visible).map((item) => story(item, false))}
      </ol>
      {visible < list.length && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </>
  );
}
