import Script from "next/script";

// Visits are counted on our own Umami server (analytics.flossypurse.studio):
// no cookies, no IP stored, so there is nothing to ask consent for and no
// banner. The website id is not a secret; every visitor's browser sends it.
// data-domains keeps previews and local builds out of the counts; query
// strings and hashes are dropped. Umami follows App Router navigations
// through the History API on its own.
export function Analytics() {
  return (
    <Script
      src="https://analytics.flossypurse.studio/script.js"
      data-website-id="52a42e6c-da02-4fc1-ad9e-fc4ba2715146"
      data-domains="pitchroots.ca"
      data-exclude-search="true"
      data-exclude-hash="true"
      data-do-not-track="true"
      strategy="afterInteractive"
    />
  );
}
