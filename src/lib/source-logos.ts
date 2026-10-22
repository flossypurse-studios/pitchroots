import manifest from "./source-logos-manifest.json";

type ManifestEntry = { status: "ok"; file: string } | { status: "fallback"; reason: string };

const MANIFEST = manifest as Record<string, ManifestEntry>;

// The attribution mark for a source, by the exact `sources.name` string the DB
// already hands every render path. Null means no verified mark — render a
// monogram, never a broken image. Keep in lockstep with
// `scripts/fetch-source-logos.mjs`, which is what writes this manifest.
export function sourceLogoPath(sourceName: string): string | null {
  const entry = MANIFEST[sourceName];
  return entry?.status === "ok" ? entry.file : null;
}
