#!/usr/bin/env node
// Fetches each source's own attribution mark (favicon/apple-touch-icon, never an
// article image) and self-hosts a normalized 64x64 PNG under public/source-logos/.
// Re-runnable: re-run any time the registry changes or a mark goes stale.
//
// Usage: node scripts/fetch-source-logos.mjs [--only "Source Name"]
//
// Order of preference per source: apple-touch-icon > SVG <link rel=icon> >
// largest raster <link rel=icon> > /favicon.ico > og:image (last resort, and
// only kept if it looks like a mark rather than a photo). robots.txt for the
// source's own origin is checked before every fetch; a disallowed path is
// skipped and the next candidate is tried.
//
// OVERRIDES below exist for sources where the automatic pick was wrong, blank,
// or too generic — fill in after looking at the PNGs this script produces.

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "./source-registry.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "public", "source-logos");
const MANIFEST_PATH = join(ROOT, "src", "lib", "source-logos-manifest.json");

const UA = "PitchRootsLogoFetcher/1.0 (+https://pitchroots.ca; hello@pitchroots.ca)";
const TIMEOUT_MS = 10_000;
const SIZE = 64;

// Manual fixes, keyed by the exact `sources.name` string. Set `url` to force a
// specific mark, or `skip: true, reason: "..."` to deliberately keep the
// monogram fallback instead of a wrong/generic/missing mark.
const OVERRIDES = {
  // "Some Source": { url: "https://example.com/logo.svg" },
  // "Some Other Source": { skip: true, reason: "no distinct mark, only a generic CMS favicon" },
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, ua) {
  const res = await withTimeout(
    (signal) => fetch(url, { headers: { "User-Agent": ua ?? UA }, signal, redirect: "follow" }),
    TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchBuffer(url, ua) {
  const res = await withTimeout(
    (signal) => fetch(url, { headers: { "User-Agent": ua ?? UA }, signal, redirect: "follow" }),
    TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Minimal robots.txt parser: User-agent: * group only, Disallow/Allow prefixes,
// longest match wins (the de-facto standard, matching Google/Bing behaviour).
function parseRobots(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups = [];
  let current = null;
  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current || current.agents.length === 0 || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "disallow" || key === "allow") && current) {
      // An empty value (`Disallow:` with nothing after it) is the standard way
      // to say "nothing is disallowed" — not a rule that matches every path.
      // `"/x".startsWith("")` is always true in JS, so an empty-path rule left
      // in would win the longest-match comparison below and block everything.
      if (value === "") continue;
      current.rules.push({ type: key, path: value });
    }
  }
  const star = groups.find((g) => g.agents.includes("*"));
  return star?.rules ?? [];
}

async function robotsAllows(origin, path, cache, ua) {
  if (!cache.has(origin)) {
    try {
      const text = await fetchText(`${origin}/robots.txt`, ua);
      cache.set(origin, parseRobots(text));
    } catch {
      cache.set(origin, []); // no robots.txt, or unreadable -> nothing disallowed
    }
  }
  const rules = cache.get(origin);
  let best = null;
  for (const rule of rules) {
    if (path.startsWith(rule.path)) {
      if (!best || rule.path.length > best.path.length) best = rule;
    }
  }
  return !best || best.type === "allow";
}

// Attribute values aren't always quoted (Postmedia's markup ships bare
// `rel=apple-touch-icon sizes=120x120`), so match quoted OR bare-token values.
function getAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function extractLinkIcons(html) {
  const icons = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkRe)) {
    const tag = match[0];
    const rel = getAttr(tag, "rel")?.toLowerCase() ?? "";
    if (!rel.includes("icon")) continue;
    const href = getAttr(tag, "href");
    if (!href) continue;
    const sizesAttr = getAttr(tag, "sizes") ?? "";
    const sizeMatch = /(\d+)x\d+/i.exec(sizesAttr);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : href.endsWith(".svg") ? 9999 : 0;
    icons.push({
      href,
      isAppleTouch: rel.includes("apple-touch-icon"),
      isSvg: href.toLowerCase().endsWith(".svg"),
      size,
    });
  }
  return icons;
}

function extractOgImage(html) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .find((t) => getAttr(t, "property")?.toLowerCase() === "og:image");
  return tag ? getAttr(tag, "content") : null;
}

function resolveUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function buildCandidates(source, robotsCache) {
  const override = OVERRIDES[source.name];
  if (override?.skip) return { candidates: [], reason: override.reason ?? "manual skip", ua: source.ua_override ?? undefined };
  if (override?.url) {
    return {
      candidates: [{ url: override.url, label: "override" }],
      reason: null,
      ua: source.ua_override ?? undefined,
    };
  }

  const origin = new URL(source.home_url).origin;
  const ua = source.ua_override ?? undefined;
  const candidates = [];

  let html = null;
  const homePath = new URL(source.home_url).pathname || "/";
  if (await robotsAllows(origin, homePath, robotsCache, ua)) {
    try {
      html = await fetchText(source.home_url, ua);
    } catch (err) {
      candidates.push({ error: `homepage fetch failed: ${err.message}` });
    }
  } else {
    candidates.push({ error: "robots.txt disallows the homepage path" });
  }

  if (html) {
    const icons = extractLinkIcons(html).map((i) => ({ ...i, url: resolveUrl(source.home_url, i.href) }))
      .filter((i) => i.url);
    const appleTouch = icons.filter((i) => i.isAppleTouch).sort((a, b) => b.size - a.size);
    const svgIcons = icons.filter((i) => !i.isAppleTouch && i.isSvg);
    const rasterIcons = icons.filter((i) => !i.isAppleTouch && !i.isSvg).sort((a, b) => b.size - a.size);
    for (const i of appleTouch) candidates.push({ url: i.url, label: "apple-touch-icon" });
    for (const i of svgIcons) candidates.push({ url: i.url, label: "svg icon" });
    for (const i of rasterIcons) candidates.push({ url: i.url, label: "rel=icon" });
  }

  const favicon = resolveUrl(origin, "/favicon.ico");
  if (favicon && (await robotsAllows(origin, "/favicon.ico", robotsCache, ua))) {
    candidates.push({ url: favicon, label: "/favicon.ico" });
  }

  if (html) {
    const og = extractOgImage(html);
    const ogUrl = og ? resolveUrl(source.home_url, og) : null;
    if (ogUrl) candidates.push({ url: ogUrl, label: "og:image (last resort)" });
  }

  return { candidates, reason: null, ua };
}

async function fetchAndNormalize(url, ua) {
  const buf = await fetchBuffer(url, ua);
  const img = sharp(buf, { animated: false });
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) {
    throw new Error(`too small (${meta.width}x${meta.height})`);
  }
  const png = await img
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return { png, meta };
}

async function run() {
  const onlyArgIdx = process.argv.indexOf("--only");
  const only = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;
  const sources = only ? SOURCES.filter((s) => s.name === only) : SOURCES;
  if (only && sources.length === 0) {
    console.error(`No source named ${JSON.stringify(only)}`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const robotsCache = new Map();
  // Seed from any existing manifest so a `--only` re-run (or a run that fails
  // partway through) touches only the sources it actually processed, rather
  // than truncating every other source's entry to nothing.
  const manifest = await readFile(MANIFEST_PATH, "utf8").then(JSON.parse).catch(() => ({}));
  const summary = [];

  for (const source of sources) {
    const key = slugify(source.name);
    const { candidates, reason: skipReason, ua } = await buildCandidates(source, robotsCache);

    if (skipReason) {
      manifest[source.name] = { key, status: "fallback", reason: skipReason };
      summary.push({ name: source.name, status: "fallback", reason: skipReason });
      continue;
    }

    let done = false;
    const errors = [];
    for (const c of candidates) {
      if (c.error) {
        errors.push(c.error);
        continue;
      }
      try {
        const { png, meta } = await fetchAndNormalize(c.url, ua);
        await writeFile(join(OUT_DIR, `${key}.png`), png);
        manifest[source.name] = {
          key,
          status: "ok",
          file: `/source-logos/${key}.png`,
          picked: c.label,
          sourceUrl: c.url,
          originalSize: `${meta.width}x${meta.height}`,
        };
        summary.push({ name: source.name, status: "ok", picked: c.label, url: c.url });
        done = true;
        break;
      } catch (err) {
        errors.push(`${c.label ?? c.url}: ${err.message}`);
      }
    }

    if (!done) {
      const reason = errors.length ? errors.join("; ") : "no icon candidates found";
      manifest[source.name] = { key, status: "fallback", reason };
      summary.push({ name: source.name, status: "fallback", reason });
    }
  }

  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

  console.log("\nSummary:");
  for (const s of summary) {
    if (s.status === "ok") {
      console.log(`  ok       ${s.name}  (${s.picked} <- ${s.url})`);
    } else {
      console.log(`  fallback ${s.name}  (${s.reason})`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
