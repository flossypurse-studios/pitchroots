// HTML/XML character references, decoded rather than deleted: dropping "&#8217;"
// turns "RCMP's" into "RCMPs", and the old stripHtml() dropped every decimal
// numeric reference outright while leaving hex ones (&#xe9;) untouched, which is
// the Montr&#xe9;al-on-the-live-site bug. Decimal and hex numeric references cover
// every valid Unicode code point and are what real feeds actually use for anything
// non-ASCII (undeclared HTML named entities like &eacute; are not valid XML, so
// generators numeric-escape instead) — this handles all of them losslessly. The
// small NAMED table covers the few named references that do leak into feeds
// despite that. Anything else is left exactly as written, never guessed at or
// silently dropped. Plain JS (no Deno, no network) so `node` can assert it
// directly — see ../../../scripts/assert-entities.mjs.
//
// One pass, left-to-right, non-overlapping: "&amp;lt;" decodes to the literal text
// "&lt;", never all the way to "<". A second pass over the output would double-decode.
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}
