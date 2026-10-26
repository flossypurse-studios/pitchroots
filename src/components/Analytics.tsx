import Script from "next/script";

// Visits are counted on our own Umami server (analytics.flossypurse.studio):
// no cookies, no IP stored, so there is nothing to ask consent for and no
// banner. The website id is not a secret; every visitor's browser sends it.
// data-domains keeps previews and local builds out of the counts; hashes are
// dropped, and every query param except the utm_* campaign tags is dropped by
// flossyKeepUtm (data-before-send), as is the referrer's query string; on any
// error it sends the bare path. Umami follows App Router navigations through
// the History API on its own.
const KEEP_UTM = `window.flossyKeepUtm = function (type, payload) {
  try {
    var u = new URL(payload.url, location.origin);
    var keep = new URLSearchParams();
    u.searchParams.forEach(function (v, k) { if (k.indexOf("utm_") === 0) keep.append(k, v); });
    var s = keep.toString();
    payload.url = u.pathname + (s ? "?" + s : "");
    if (payload.referrer) {
      var r = new URL(payload.referrer, location.origin);
      payload.referrer = r.origin === location.origin ? r.pathname : r.origin + r.pathname;
    }
  } catch (e) {
    try { payload.url = location.pathname; payload.referrer = undefined; } catch (e2) {}
  }
  return payload;
};`;

export function Analytics() {
  return (
    <>
      <Script id="flossy-keep-utm" strategy="beforeInteractive">
        {KEEP_UTM}
      </Script>
      <Script
        src="https://analytics.flossypurse.studio/script.js"
        data-website-id="52a42e6c-da02-4fc1-ad9e-fc4ba2715146"
        data-domains="pitchroots.ca"
        data-before-send="flossyKeepUtm"
        data-exclude-hash="true"
        data-do-not-track="true"
        strategy="afterInteractive"
      />
    </>
  );
}
