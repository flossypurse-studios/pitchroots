// Generative brand art for the post card — a different field behind every item,
// drawn from the same short list of rules every time.
//
// The approach: fix the grid, the inks and the region, then let a handful of
// parameters move inside deliberately narrow ranges. Wide enough that no two
// cards match, narrow enough that all of them are obviously the same publication.
//
// THE SEED IS THE ITEM ID, never Math.random(). A generator seeded from the
// clock cannot reproduce a card it has already drawn, and this one is served
// from a long-cached URL that external clients refetch whenever they please —
// so item 412 must draw the same field today, on a cold function, and after a
// cache purge next year. Same input, same picture.
//
// Everything below is built from absolutely-positioned divs and border-radius,
// because that is what satori actually renders. No canvas, no SVG paths, no
// conic gradients, no box-shadow — those either no-op or throw at render time.
import { createElement as h } from "react";

// ── seeding ──────────────────────────────────────────────────────────────────
// mulberry32: small, fast, and good enough for decoration. The point is not
// cryptographic quality, it is that the sequence is a pure function of the id.
function rng(seed) {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);
const pick = (r, xs) => xs[Math.floor(r() * xs.length) % xs.length];

// ── shared drawing vocabulary ────────────────────────────────────────────────
// Two inks, and the whole system is built from them. The alpha rule is the
// guardrail that matters, and it is two rules, not one:
//   FIELD elements — the lines, rings and ridges that span the card — stay at or
//   below 0.12. Above that they stop being a field and compete with the type.
//   ACCENT marks — the single small bark dot or arc, a few hundred square pixels
//   at most — run 0.28 to 0.5. They are legible BECAUSE they are tiny, and they
//   are kept off the headline by clearsHeadline() below rather than by being
//   faded until they vanish.
// Do not "fix" an accent's alpha down to the field ceiling; it is not a field.
const INK = (a) => `rgba(255,251,244,${a})`;
const BARK_INK = (a) => `rgba(217,123,74,${a})`;
const LINE = 3;

const abs = (style) => ({ position: "absolute", ...style });

// A stroked circle. Satori honours borderRadius on a bordered box, which is the
// only way to get an arc here — so partial arcs are made by letting the circle
// run off the canvas and cropping, exactly as a real pitch marking is cropped by
// the touchline.
function ring(key, cx, cy, r, color, w = LINE) {
  return h("div", {
    key,
    style: abs({
      left: cx - r,
      top: cy - r,
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      border: `${w}px solid ${color}`,
    }),
  });
}

function bar(key, x, y, w, hh, color, extra = {}) {
  return h("div", { key, style: abs({ left: x, top: y, width: w, height: hh, background: color, ...extra }) });
}

function box(key, x, y, w, hh, color, weight = LINE) {
  return h("div", {
    key,
    style: abs({ left: x, top: y, width: w, height: hh, border: `${weight}px solid ${color}` }),
  });
}

// Where the headline sits. The faint 0.07-0.10 field lines may cross it freely —
// that is what a field is for — but the bark accent is a solid 0.5 dot, and a
// solid dot behind cream type reads as a speck of dirt on the card rather than
// as a penalty spot. So the accent is drawn only when it clears this zone.
//
// The zone is the LEFT of the headline band, not the full width: the headline is
// left-aligned and always occupies the left, while its right end depends on text
// metrics this module cannot see. Bounding what is knowable keeps the accents
// that sit clear to the right — the good ones — instead of suppressing them all.
const QUIET = { x0: 40, x1: 780, y0: 190, y1: 450 };
const clearsHeadline = (x, y) => x < QUIET.x0 || x > QUIET.x1 || y < QUIET.y0 || y > QUIET.y1;

// Push an accent only where it will not foul the type. Deliberately no fallback
// position: bark still appears in the masthead bar and the footer rule on every
// card, so a field with no accent is quieter, never incomplete.
function accent(nodes, key, x, y, rad, color, weight) {
  if (clearsHeadline(x, y)) nodes.push(ring(key, x, y, rad, color, weight));
}

// ── A. pitch — the markings, cropped by a seeded camera ──────────────────────
//
// The strict part is that this is never decoration: every element is a real
// marking at real proportion (centre circle 9.15m on a 68m width, penalty area
// 40.3x16.5m, corner arc 1m), so any crop of it reads as a football pitch. The
// free part is where the camera sits — which corner of which third, at what
// scale — plus a quarter-turn for the touchline. One bark-inked element per
// card marks the accent and moves with the camera.
function pitchArt(r, W, H) {
  const view = pick(r, ["centre", "penalty", "corner"]);
  const s = between(r, 0.85, 1.25); // camera height: how much pitch is in frame
  const nodes = [];

  if (view === "centre") {
    // Halfway line and centre circle, pushed off-centre so the composition is
    // never symmetrical — a centred centre-circle reads as a diagram, not a crop.
    const cx = between(r, 0.18, 0.82) * W;
    const cy = between(r, 0.34, 0.72) * H;
    const rad = 165 * s;
    nodes.push(bar("hl", cx - LINE / 2, -40, LINE, H + 80, INK(0.1)));
    nodes.push(ring("cc", cx, cy, rad, INK(0.1)));
    accent(nodes, "spot", cx, cy, 7 * s, BARK_INK(0.5), 7 * s);
  } else if (view === "penalty") {
    // The 18-yard box entering from a seeded edge, with the D overlapping it.
    const fromLeft = r() < 0.5;
    const bw = 300 * s, bh = 470 * s;
    const bx = fromLeft ? -bw * between(r, 0.3, 0.55) : W - bw * between(r, 0.45, 0.7);
    const by = between(r, 0.05, 0.42) * H - bh * 0.15;
    nodes.push(box("pa", bx, by, bw, bh, INK(0.1)));
    nodes.push(box("ga", fromLeft ? bx : bx + bw - 135 * s, by + bh * 0.31, 135 * s, bh * 0.38, INK(0.08)));
    nodes.push(ring("d", fromLeft ? bx + bw : bx, by + bh / 2, 128 * s, INK(0.1)));
    accent(nodes, "pk", fromLeft ? bx + bw - 92 * s : bx + 92 * s, by + bh / 2, 7 * s, BARK_INK(0.5), 7 * s);
  } else {
    // A corner: two touchlines meeting, the 1m arc, and the flag. The quadrant
    // is seeded, so the same view still lands somewhere new.
    const left = r() < 0.5, top = r() < 0.5;
    const gx = (left ? between(r, 0.06, 0.3) : between(r, 0.7, 0.94)) * W;
    const gy = (top ? between(r, -0.12, 0.1) : between(r, 0.9, 1.12)) * H;
    nodes.push(bar("tl", gx - LINE / 2, -40, LINE, H + 80, INK(0.1)));
    nodes.push(bar("gl", -40, gy - LINE / 2, W + 80, LINE, INK(0.1)));
    accent(nodes, "arc", gx, gy, 58 * s, BARK_INK(0.28), LINE);
    nodes.push(ring("wide", gx, gy, 320 * s, INK(0.07)));
  }
  return nodes;
}

// ── B. treeline — the Group of Seven register, as layered ridges ─────────────
//
// globals.css calls the palette "the Group of Seven register", and this is that
// literally: three ridgelines receding into haze. Each ridge is a contiguous run
// of columns whose height is one low-frequency sine — the same trick a spectrum
// bar field uses, turned on its side and closed up so it silhouettes not bars.
// Frequency stays low on purpose: crank it and boreal hills become a sawtooth.
function treelineArt(r, W, H) {
  const nodes = [];
  const RIDGES = 3;
  const COLS = 60;

  for (let k = 0; k < RIDGES; k++) {
    // depth 0 is the far ridge: higher on the canvas, fainter, and flatter.
    // Distance flattens a horizon — a back ridge that undulates as hard as the
    // front one reads as noise rather than depth.
    const depth = k / (RIDGES - 1 || 1);
    const baseY = H * (0.58 + depth * 0.17);
    const amp = H * between(r, 0.045, 0.085) * (0.55 + depth * 0.45);
    const freq = between(r, 0.055, 0.1);
    const phase = between(r, 0, Math.PI * 2);
    const alpha = 0.05 + k * 0.022;

    for (let i = 0; i < COLS; i++) {
      const y = baseY + Math.sin(i * freq + phase) * amp;
      // Columns must TILE, not overlap. These are translucent, so a one-pixel
      // overlap doubles the alpha down a seam and the ridge renders as pinstripe
      // — which is exactly what a ceil()+1 width produced. Snapping both edges
      // to the same rounded boundary gives abutment with no gap and no seam.
      const x0 = Math.round((i * W) / COLS);
      const x1 = Math.round(((i + 1) * W) / COLS);
      nodes.push(bar(`r${k}-${i}`, x0, y, x1 - x0, H - y + 4, INK(alpha)));
    }
  }
  // No bark here on purpose. The accent's home on this card is the masthead bar
  // and the footer rule; a bark horizon line landing mid-canvas cuts straight
  // through a three- or four-line headline, and the ridges do not need it.
  return nodes;
}

// ── C. roots — a seeded branching system from the bottom edge ────────────────
//
// The other half of the name. A recursive branch, each segment a thin rotated
// div. Rotation is about each segment's own centre, which is satori's default
// origin — transformOrigin is not reliably supported, so the maths places the
// midpoint rather than the end and the origin never has to be set.
function rootsArt(r, W, H) {
  const nodes = [];
  const forks = [];
  let n = 0;

  function branch(x, y, angle, len, depth, weight) {
    if (depth === 0 || len < 16) return;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    const mx = (x + x2) / 2, my = (y + y2) / 2;
    // Fainter as it thins out, so the eye reads growth direction without the
    // lattice ever thickening into a texture that fights the headline.
    const a = 0.045 + depth * 0.016;
    nodes.push(
      h("div", {
        key: `b${n++}`,
        style: abs({
          left: mx - len / 2,
          top: my - weight / 2,
          width: len,
          height: weight,
          background: INK(a),
          transform: `rotate(${(angle * 180) / Math.PI}deg)`,
        }),
      }),
    );
    // Every split is a candidate for the accent. Recorded rather than invented:
    // a bark dot dropped at a seeded coordinate lands in empty space as often as
    // not, and a node that is not on the structure reads as a smudge.
    if (depth >= 3) forks.push({ x: x2, y: y2 });
    const spread = between(r, 0.32, 0.62);
    const shrink = between(r, 0.62, 0.78);
    branch(x2, y2, angle - spread, len * shrink, depth - 1, Math.max(1, weight * 0.7));
    branch(x2, y2, angle + spread, len * shrink, depth - 1, Math.max(1, weight * 0.7));
    // A third shoot only sometimes — two-way splits everywhere read mechanical.
    if (r() < 0.35) branch(x2, y2, angle + between(r, -0.12, 0.12), len * shrink * 0.8, depth - 1, Math.max(1, weight * 0.6));
  }

  // Two or three trunks rising from below the bottom edge, so the origin is
  // always cropped and the structure feels like part of something larger.
  const trunks = 2 + (r() < 0.5 ? 1 : 0);
  for (let t = 0; t < trunks; t++) {
    const x = between(r, 0.1 + t * 0.28, 0.28 + t * 0.28) * W;
    branch(x, H + 30, -Math.PI / 2 + between(r, -0.3, 0.3), between(r, 150, 215), 5, 7);
  }
  // The accent: one real fork, marked. Preferring the lower half keeps it clear
  // of the headline block, which occupies the middle band on a long title.
  const low = forks.filter((f) => f.y > H * 0.5);
  const node = pick(r, low.length ? low : forks);
  if (node) accent(nodes, "node", node.x, node.y, 9, BARK_INK(0.45), 9);
  return nodes;
}

export const PATTERNS = ["pitch", "treeline", "roots", "stripes"];

/**
 * The art layer for one card: an absolutely-positioned field behind the content.
 *
 * @param {string} pattern  one of PATTERNS
 * @param {number} seed     the item id — same id, same field, forever
 * @param {number} W @param {number} H  card dimensions
 */
export function artLayer(pattern, seed, W, H) {
  // "stripes" is the original mown-pitch gradient, kept as the fallback so the
  // card still renders if a pattern name ever arrives from somewhere unexpected.
  if (pattern === "stripes") {
    return h("div", {
      style: abs({
        left: 0,
        top: 0,
        width: W,
        height: H,
        backgroundImage:
          "linear-gradient(90deg, rgba(255,255,255,0.06) 0 50%, rgba(255,255,255,0) 50% 100%)",
        backgroundSize: "200px 100%",
      }),
    });
  }

  const r = rng(seed);
  const draw = pattern === "treeline" ? treelineArt : pattern === "roots" ? rootsArt : pitchArt;
  return h(
    "div",
    // overflow:hidden is what makes the crop a crop: every one of these fields
    // deliberately runs off the canvas, and without it satori grows the box.
    { style: abs({ left: 0, top: 0, width: W, height: H, display: "flex", overflow: "hidden" }) },
    ...draw(r, W, H),
  );
}
