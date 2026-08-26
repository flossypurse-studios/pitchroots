// Render the post card to PNG on this machine, no dev server and no deploy.
//
//   node scripts/render-social-cards.mjs <out-dir> [pattern ...]
//
// With no pattern named it renders every one in PATTERNS, so the directions can
// be compared against the same headlines. It imports the SAME modules the
// production route renders, so what lands in <out-dir> is the real output rather
// than a lookalike — the whole reason the template is a shared module and not a
// layout copied into a route.
//
// `next/og` is CommonJS and Next's exports map does not expose it to ESM
// resolution, so it comes in through createRequire rather than a bare import.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { socialCard, cardFonts, CARD_SIZE } from "../src/lib/social-card.mjs";
import { PATTERNS } from "../src/lib/social-card-art.mjs";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/og");

// Real items off the live feed, picked to exercise the type scale end to end:
// the short headline, the two-tag masthead, the accented name, and the 90+
// character monster that the smallest bucket has to absorb. The seeds are spread
// out so consecutive cards show the generator's range rather than its middle.
const SAMPLES = [
  { seed: 7, title: "Canada Soccer Election Results", sourceName: "Canada Soccer", tagLabels: ["CanMNT"] },
  { seed: 41, title: "Canadian defender Bombito set for second surgery on left tibia", sourceName: "Sportsnet Soccer", tagLabels: ["CanMNT"] },
  { seed: 96, title: "Whitecaps sign Canadian U20 star Emrick Fotsing from Vancouver FC", sourceName: "AFTN", tagLabels: ["MLS", "British Columbia"] },
  { seed: 158, title: "Mauro Eustaquio adamant Inter Toronto will make playoffs despite sitting 7th in CPL", sourceName: "Northern Tribune", tagLabels: ["CPL", "Ontario"] },
  { seed: 203, title: "Olivia Smith predictions, Promise David to Brighton & Nathan Saliba to Villarreal", sourceName: "CBC Soccer", tagLabels: ["Women's", "CanWNT"] },
  { seed: 274, title: "NSL week in review: Calgary brings out the Wild card and the Vancouver Rise shine", sourceName: "Le Devoir — Québec", tagLabels: ["NSL", "Québec"] },
];

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/render-social-cards.mjs <out-dir> [pattern ...]");
  process.exit(1);
}
const patterns = only.length ? only : PATTERNS;

const fonts = await cardFonts();

for (const pattern of patterns) {
  const dir = join(outDir, pattern);
  await mkdir(dir, { recursive: true });
  for (const [i, s] of SAMPLES.entries()) {
    const res = new ImageResponse(socialCard({ ...s, pattern }), { ...CARD_SIZE, fonts });
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${String(i + 1).padStart(2, "0")}-seed${s.seed}.png`;
    await writeFile(join(dir, file), buf);
    // The byte count is the number that matters downstream: a Bluesky blob is
    // capped at 1,000,000 bytes, and a card that quietly crosses it fails at
    // upload time on the one path nobody is watching.
    console.log(`${pattern.padEnd(9)} ${file.padEnd(16)} ${String(buf.length).padStart(7)} bytes`);
  }
}
