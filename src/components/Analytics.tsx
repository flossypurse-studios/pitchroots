"use client";

import Script from "next/script";
import { useCookieConsent } from "./CookieConsent";

// ⚠ NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, not read at
// runtime. If this is empty when the build runs, `!GA_ID` is statically true,
// everything below becomes dead code, Next.js tree-shakes it out, and the build
// succeeds — the site ships measuring nothing and every page still renders
// normally, so nobody notices. That is exactly how tamrack.ca lost ~80 days of
// analytics. A Vercel environment variable added *after* a deploy cannot fix a
// bundle that was already built without it; the project has to be rebuilt.
// next.config.ts fails the production build outright rather than let that ship.
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function Analytics() {
  const consent = useCookieConsent();

  if (!GA_ID || consent !== "granted") return null;

  // Mounted only once consent is granted, which is also what sends the first
  // page_view — GA4's enhanced measurement picks up subsequent App Router
  // navigations from the History API, so there is no manual pageview call here.
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  );
}
