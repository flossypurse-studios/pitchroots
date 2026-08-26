import { ImageResponse } from "next/og";
import { itemCard } from "@/lib/db";
import { tagBySlug } from "@/lib/tags";
import { socialCard, cardFonts, CARD_SIZE } from "@/lib/social-card.mjs";

// GET /api/social-card/<item id> -> 1200x630 PNG: that item's headline set on the
// brand art. Rendered here rather than in the Deno poll function because
// ImageResponse (satori + resvg) is a Next/Vercel capability and reimplementing
// the rasteriser inside an Edge Function to save one HTTP call would be a bad
// trade — and because a card at a URL can be opened and looked at, which is the
// only way a design that only ever runs unattended stays honest.
//
// Keyed by ITEM ID, never by free text. An endpoint that renders whatever string
// it is handed onto the PitchRoots wordmark is a brand-impersonation surface with
// our own CDN in front of it; taking an id means the only headlines this can draw
// are ones the pipeline already published.
export const runtime = "nodejs";

// Errors are cached too, briefly. Long enough that a scan of absent ids cannot
// turn into a database connection per request, short enough that an item which
// appears a minute later is not denied for an hour.
const MISS_HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=3600" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Nine digits, not ten. The art seeds a 32-bit PRNG, which truncates with
  // `>>> 0` — so id 1 and id 4294967297 would draw byte-identical cards. Capping
  // the accepted id below 2^32 makes that collision unreachable rather than
  // merely unlikely. `items.id` is nowhere near this; the cap is the guarantee.
  if (!/^[1-9][0-9]{0,8}$/.test(id)) {
    return new Response("bad item id", { status: 400, headers: MISS_HEADERS });
  }

  const item = await itemCard(Number(id));
  // Misses must be cacheable. Unauthenticated and uncached, a walk through
  // well-formed-but-absent ids is a free way to make thousands of cold
  // invocations, each taking a connection from the `max: 1` pool against the
  // same Postgres the ingestion engine writes to.
  if (!item) return new Response("no such item", { status: 404, headers: MISS_HEADERS });

  // Slugs resolve to display labels through the canonical vocabulary, so the card
  // can never grow a second set of names for the same tags. Order comes from TAGS
  // (leagues and national teams ahead of provinces), matching how composePost
  // picks its two hashtags — the chips and the hashtags agree by construction.
  const tagLabels = (item.tags ?? [])
    .map((slug) => tagBySlug(slug))
    .filter((t) => t !== undefined)
    .map((t) => t!.shortLabel ?? t!.label);

  const rendered = new ImageResponse(
    socialCard({
      title: item.title,
      sourceName: item.source_name,
      tagLabels,
      // The id IS the seed. Not a hash of the title (a corrected headline would
      // redraw the art) and not a random number (this response is cached and
      // Bluesky refetches thumbs — the same URL must always return the same
      // picture).
      seed: Number(id),
      pattern: process.env.SOCIAL_CARD_PATTERN ?? "pitch",
    }),
    { ...CARD_SIZE, fonts: await cardFonts() },
  );

  // Force the render to completion HERE, before any status reaches the wire.
  //
  // ImageResponse sets 200 + image/png in its constructor and only renders inside
  // the response stream, so a satori or resvg failure — an unsupported glyph, a
  // font that failed to load — errors the stream when the 200 is already sent.
  // The consumer of this endpoint treats any non-200 as "post without a picture",
  // and a truncated 200 image/png defeats exactly that check: it would upload a
  // corrupt blob to a live account. Buffering converts a render failure into an
  // honest 500.
  let png: ArrayBuffer;
  try {
    png = await rendered.arrayBuffer();
  } catch (err) {
    console.error(`social card ${id}: render failed`, err);
    return new Response("render failed", { status: 500, headers: MISS_HEADERS });
  }

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // Long-lived but NOT `immutable`. A published headline is stable in
      // practice, not in principle — and `immutable` would make a corrected one
      // unrecallable from browser and scraper caches for a year, with no URL to
      // bust. `stale-while-revalidate` keeps the cheap path cheap and still lets
      // a correction propagate.
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
    },
  });
}
