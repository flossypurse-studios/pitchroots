import type { NextConfig } from "next";
import { TAG_SLUGS } from "./src/lib/tags";

const nextConfig: NextConfig = {
  // The social card reads its Archivo files with readFile(process.cwd()/assets).
  // Tracing follows imports, not filesystem reads, so without this the route
  // deploys without its fonts and fails at request time — on a deploy whose build
  // went green and whose every page renders. Stated explicitly rather than left
  // to static analysis of the path expression.
  // The source logo manifests and PNGs are the same story: sourceMark() in
  // social-card.mjs readFileSync's them directly rather than importing them, so
  // a missing entry here is a silent fallback-to-monogram in production, never
  // a build failure.
  outputFileTracingIncludes: {
    "/api/social-card/[id]": [
      "./assets/Archivo-*.ttf",
      "./public/source-logos/*.png",
      "./public/source-logos-256/*.png",
      "./src/lib/source-logos-manifest.json",
      "./src/lib/source-logos-256-manifest.json",
    ],
  },

  // The 2026-08 information-architecture change: the news feed moved from `/`
  // to `/news` and every tag hub from `/<tag>` to `/news/<tag>`, with `/` now a
  // landing page. The hubs are the site's whole SEO surface, so each old URL
  // 308s to its new home. Enumerated from the fixed tag vocabulary rather than
  // a `/:slug` catch-all, which would swallow /about, /games, and anything the
  // app grows next.
  async redirects() {
    return TAG_SLUGS.map((slug) => ({
      source: `/${slug}`,
      destination: `/news/${slug}`,
      permanent: true,
    }));
  },
};

export default nextConfig;
