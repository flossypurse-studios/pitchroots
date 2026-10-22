#!/usr/bin/env node
// Re-fetches a crisper 256x256 variant of each source's already-verified mark,
// for the social card's attribution strip — the 64x64 file in public/source-logos/
// looks soft blown up to the size the card needs. Reuses the exact `sourceUrl`
// (and `ua_override`) that fetch-source-logos.mjs already verified, so this never
// re-walks robots.txt or re-picks a candidate; it only re-resizes from the same
// original, which is why it is a separate small script rather than a flag on
// that one.
//
// Usage: node scripts/fetch-social-card-logos.mjs [--only "Source Name"]

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "./source-registry.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "public", "source-logos-256");
const SOURCE_MANIFEST_PATH = join(ROOT, "src", "lib", "source-logos-manifest.json");
const OUT_MANIFEST_PATH = join(ROOT, "src", "lib", "source-logos-256-manifest.json");

const UA = "PitchRootsLogoFetcher/1.0 (+https://pitchroots.ca; hello@pitchroots.ca)";
const TIMEOUT_MS = 10_000;
const SIZE = 256;

async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url, ua) {
  const res = await withTimeout(
    (signal) => fetch(url, { headers: { "User-Agent": ua ?? UA }, signal, redirect: "follow" }),
    TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function run() {
  const onlyArgIdx = process.argv.indexOf("--only");
  const only = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;

  const sourceManifest = JSON.parse(await readFile(SOURCE_MANIFEST_PATH, "utf8"));
  const outManifest = await readFile(OUT_MANIFEST_PATH, "utf8").then(JSON.parse).catch(() => ({}));
  const byName = new Map(SOURCES.map((s) => [s.name, s]));

  await mkdir(OUT_DIR, { recursive: true });
  const names = only ? [only] : Object.keys(sourceManifest);
  const summary = [];

  for (const name of names) {
    const entry = sourceManifest[name];
    if (!entry || entry.status !== "ok") {
      summary.push({ name, status: "skipped", reason: "no verified 64px mark" });
      continue;
    }
    const ua = byName.get(name)?.ua_override ?? undefined;
    try {
      const buf = await fetchBuffer(entry.sourceUrl, ua);
      const png = await sharp(buf, { animated: false })
        .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      await writeFile(join(OUT_DIR, `${entry.key}.png`), png);
      outManifest[name] = { key: entry.key, status: "ok", file: `/source-logos-256/${entry.key}.png` };
      summary.push({ name, status: "ok" });
    } catch (err) {
      summary.push({ name, status: "failed", reason: err.message });
    }
  }

  await writeFile(OUT_MANIFEST_PATH, JSON.stringify(outManifest, null, 2) + "\n");

  console.log("\nSummary:");
  for (const s of summary) {
    console.log(`  ${s.status.padEnd(8)} ${s.name}${s.reason ? `  (${s.reason})` : ""}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
