import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { TAG_SLUGS } from "./src/lib/tags";

// Fail the build rather than ship a site that measures nothing.
//
// NEXT_PUBLIC_GA_MEASUREMENT_ID is inlined into the client bundle at build
// time. If it is absent, `if (!GA_ID) return null` in Analytics.tsx is
// statically true, the whole GA branch is tree-shaken away, and `next build`
// succeeds — the deploy goes green, every page renders, and the site is
// untracked. Nobody notices, because there is nothing to notice. tamrack.ca ran
// roughly 80 days that way.
//
// Vercel is the deploy target, so the ID comes from a Project Environment
// Variable and is baked into whichever build reads it. Two consequences worth
// stating plainly: adding the variable does NOT fix already-deployed bundles
// (redeploy required), and no runtime secret can substitute for it.
//
// Escape hatch for a deliberately untracked build: ALLOW_MISSING_GA=true.
function assertAnalyticsWired() {
  if (process.env.ALLOW_MISSING_GA === "true") {
    console.warn("WARNING: building without analytics (ALLOW_MISSING_GA=true)");
    return;
  }

  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

  // `G-` followed by at least one character — a bare "G-" must not pass.
  if (/^G-.+$/.test(id)) {
    console.log(`GA measurement ID present: ${id}`);
    return;
  }

  const problem =
    id === ""
      ? "NEXT_PUBLIC_GA_MEASUREMENT_ID is empty."
      : `NEXT_PUBLIC_GA_MEASUREMENT_ID='${id}' does not look like a GA4 ID (expected G-...).`;

  throw new Error(
    [
      `ERROR: ${problem}`,
      "  Set it as a Vercel Project Environment Variable (Production + Preview),",
      "  or export it in the shell for a local build. NEXT_PUBLIC_* is inlined at",
      "  build time; a runtime secret CANNOT supply it, and a variable added after",
      "  a deploy does not reach that deploy's bundle — redeploy.",
      "  For a deliberately untracked build: ALLOW_MISSING_GA=true next build",
    ].join("\n"),
  );
}

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

// Function form so the guard keys off the build phase: `next dev` must not
// demand a measurement ID, and `next start` is too late to be worth failing.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertAnalyticsWired();
  return nextConfig;
}
