// The PitchRoots post card — one item's headline set on the brand art, 1200x630.
//
// Fixed frame, generative field. This file owns the parts that never move — the
// pitch-strong ground, the masthead, the type scale, the credit, bark as the lone
// accent (globals.css says burnt sienna is the ONLY supporting colour; resist
// inventing a second one to make a card "pop"). social-card-art.mjs owns the part
// that is different on every card, seeded from the item id.
//
// Written as plain React.createElement in .mjs rather than .tsx so that exactly one
// file feeds both the production route and social/render-samples.mjs. A preview
// that renders through a second copy of the layout is a preview of the wrong thing.
//
// Satori's CSS subset, not a browser's: flexbox only (no grid, no float), every
// element with more than one child needs an explicit display:flex, and shorthand
// like `border` resolves but `background` shorthand with multiple layers does not.
import { createElement as h } from "react";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { artLayer } from "./social-card-art.mjs";

export const CARD_SIZE = { width: 1200, height: 630 };

// Taiga Autumn, dark-ground variants. Lifted from globals.css :root and its
// prefers-color-scheme block — the card always sits on the dark ground, so it
// takes the dark-mode bark (#d97b4a); the light-mode #a34c1f muddies on pitch.
const PITCH_STRONG = "#123b1e";
const CREAM = "#fffbf4";
const BARK = "#d97b4a";
const PITCH_LIGHT = "#9fe0b0";
const MUTED = "#c8dbc4";

// Headline type scale. Chosen so the longest string in each bucket still clears
// the fixed headline box at lineHeight 1.08 — satori has no reliable line-clamp,
// so the size has to guarantee the fit rather than the overflow rule catching it.
// Buckets are in characters, which tracks rendered width closely enough for
// Archivo Black at these sizes; the top bucket is the safety net, not a target.
function headlineSize(len) {
  if (len <= 42) return 82;
  if (len <= 62) return 72;
  if (len <= 88) return 62;
  if (len <= 118) return 54;
  return 46;
}

// Only for the pathological case. §8.4 bans mid-word truncation in post *text*;
// the card is not the post text, but the same instinct applies — cut at a word
// boundary or not at all. Anything under the cap passes through untouched.
const HEADLINE_CAP = 150;
function fitHeadline(title) {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= HEADLINE_CAP) return t;
  const cut = t.slice(0, HEADLINE_CAP);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

// ── source attribution mark ──────────────────────────────────────────────────
// The point of this card: an outlet credited by name beside its own logo, not
// just named. Prefers the 256px variant fetch-social-card-logos.mjs builds for
// this exact use — the 64px file the site uses at 18px looks soft blown up to
// card size — and falls back to the 64px file, then a monogram, never a broken
// image. Read with readFileSync and memoised: a cold start pays for the disk
// read once, not once per request, and the plain-JSON read sidesteps Node's
// import-attribute requirement for `import ... with { type: "json" }`.
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

let _logoManifests = null;
function logoManifests(assetsDir) {
  if (_logoManifests) return _logoManifests;
  const root = assetsDir ?? process.cwd();
  _logoManifests = {
    hi: readJson(join(root, "src", "lib", "source-logos-256-manifest.json")),
    lo: readJson(join(root, "src", "lib", "source-logos-manifest.json")),
  };
  return _logoManifests;
}

const _logoDataUriCache = new Map();
function logoDataUri(publicPath, root) {
  if (_logoDataUriCache.has(publicPath)) return _logoDataUriCache.get(publicPath);
  let uri = null;
  try {
    const bytes = readFileSync(join(root, "public", publicPath.replace(/^\//, "")));
    uri = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    uri = null;
  }
  _logoDataUriCache.set(publicPath, uri);
  return uri;
}

const LOGO_PLATE_SIZE = 56;

function sourceMark(sourceName, assetsDir) {
  const root = assetsDir ?? process.cwd();
  const { hi, lo } = logoManifests(root);
  const hiEntry = hi[sourceName];
  const loEntry = lo[sourceName];
  const uri =
    (hiEntry?.status === "ok" && logoDataUri(hiEntry.file, root)) ||
    (loEntry?.status === "ok" && logoDataUri(loEntry.file, root)) ||
    null;

  if (uri) {
    // A light plate under every mark, win or lose on the source's own colours —
    // some marks ship with their own baked-in dark background and some are
    // transparent line art that would vanish on the card's dark pitch ground.
    // One rule that handles both beats guessing per-logo.
    const imgSize = LOGO_PLATE_SIZE - 14;
    return h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: LOGO_PLATE_SIZE,
          height: LOGO_PLATE_SIZE,
          marginRight: 20,
          borderRadius: 12,
          background: CREAM,
        },
      },
      h("img", { src: uri, width: imgSize, height: imgSize }),
    );
  }

  // No verified mark: a monogram chip, same slot and size, never a missing or
  // broken image.
  const initial = sourceName.trim().charAt(0).toUpperCase() || "?";
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: LOGO_PLATE_SIZE,
        height: LOGO_PLATE_SIZE,
        marginRight: 20,
        borderRadius: 12,
        background: BARK,
        fontSize: 28,
        fontWeight: 900,
        color: CREAM,
      },
    },
    initial,
  );
}

function chip(label, key) {
  return h(
    "div",
    {
      key,
      style: {
        display: "flex",
        alignItems: "center",
        border: "2px solid rgba(255,251,244,0.28)",
        borderRadius: 999,
        padding: "6px 22px 8px",
        marginLeft: 14,
        fontSize: 25,
        fontWeight: 600,
        color: PITCH_LIGHT,
      },
    },
    label,
  );
}

/**
 * The card element, ready to hand to ImageResponse.
 *
 * @param {{ title: string, sourceName: string, tagLabels?: string[],
 *           seed?: number, pattern?: string }} item
 *   tagLabels are display labels ("CanMNT", "Québec"), not slugs — the caller
 *   resolves them through lib/tags so the card never carries a second vocabulary.
 *   seed is the ITEM ID, not a random number: the card lives at an immutable
 *   URL that Bluesky refetches, so the same item must always draw the same field.
 */
export function socialCard({
  title,
  sourceName,
  tagLabels = [],
  seed = 0,
  pattern = "pitch",
  assetsDir,
}) {
  const headline = fitHeadline(title);

  return h(
    "div",
    {
      style: {
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "58px 68px 62px",
        background: PITCH_STRONG,
        fontFamily: "Archivo",
        color: CREAM,
      },
    },
    // The generative field, first child so everything after it paints on top.
    // It is absolutely positioned and therefore out of the column flow — the
    // masthead/headline/footer spacing below is unaffected by which art runs.
    artLayer(pattern, seed, CARD_SIZE.width, CARD_SIZE.height),
    // ── masthead: mark + wordmark on the left, up to two tags on the right ──
    h(
      "div",
      { style: { position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center" } },
        h("div", { style: { width: 12, height: 38, background: BARK, marginRight: 18 } }),
        h(
          "div",
          { style: { fontSize: 38, fontWeight: 900, letterSpacing: -1, color: CREAM } },
          "PitchRoots",
        ),
      ),
      h(
        "div",
        { style: { display: "flex", alignItems: "center" } },
        ...tagLabels.slice(0, 2).map((t, i) => chip(t, i)),
      ),
    ),

    // ── the headline, vertically centred in whatever space is left ──
    h(
      "div",
      {
        style: {
          position: "relative",
          display: "flex",
          alignItems: "center",
          flexGrow: 1,
          paddingTop: 26,
          paddingBottom: 26,
        },
      },
      h(
        "div",
        {
          style: {
            fontSize: headlineSize(headline.length),
            fontWeight: 900,
            lineHeight: 1.08,
            letterSpacing: -1.5,
            color: CREAM,
          },
        },
        headline,
      ),
    ),

    // ── footer: the credit is the point. A branded card in front of someone
    // else's reporting has to say whose reporting it is, on the image itself,
    // because the image travels further than the post text does. ──
    h(
      "div",
      { style: { position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center" } },
        sourceMark(sourceName, assetsDir),
        h(
          "div",
          { style: { fontSize: 31, fontWeight: 600, color: MUTED } },
          `via ${sourceName}`,
        ),
      ),
      h(
        "div",
        { style: { fontSize: 27, fontWeight: 600, color: "rgba(255,251,244,0.5)" } },
        "pitchroots.ca",
      ),
    ),
  );
}

// Archivo, vendored at web/assets (OFL, see assets/OFL.txt). ImageResponse takes
// font BYTES — it has no access to next/font, so the site's webfont pipeline is
// no help here and the file has to be on disk and traced into the deploy (see
// outputFileTracingIncludes in next.config.ts).
// Memoised across warm invocations: 222KB of TTF re-read from disk on every
// request is latency spent on the one path a scraper times out on.
let _fonts = null;

export async function cardFonts(assetsDir = join(process.cwd(), "assets")) {
  if (_fonts) return _fonts;
  const [black, semibold] = await Promise.all([
    readFile(join(assetsDir, "Archivo-Black.ttf")),
    readFile(join(assetsDir, "Archivo-SemiBold.ttf")),
  ]);
  // The JSDoc cast is load-bearing, not decoration: inferred from the literals
  // these widen to `number` and `string`, and ImageResponse's FontOptions wants
  // the narrow Weight union — so without it the route fails to typecheck.
  _fonts = /** @type {Array<{ name: string, data: Buffer, weight: 900 | 600, style: "normal" }>} */ ([
    { name: "Archivo", data: black, weight: 900, style: "normal" },
    { name: "Archivo", data: semibold, weight: 600, style: "normal" },
  ]);
  return _fonts;
}
