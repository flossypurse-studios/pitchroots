import type { NextConfig } from "next";
import { TAG_SLUGS } from "./src/lib/tags";

const nextConfig: NextConfig = {
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
