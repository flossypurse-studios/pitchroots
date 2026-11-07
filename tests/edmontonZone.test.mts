// Alberta's zone picker (src/lib/edmontonZone.ts). Alberta stays at UTC-6 from
// 2026-11-01T08:00Z (tzdb 2026c); the runtime's tz data may be older, so these
// must pass on old and new data alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edmontonFormat, edmontonZoneAt, UTC6_FROM_MS } from "../src/lib/edmontonZone.ts";

const time = edmontonFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

test("the cutover is 2026-11-01 at 02:00 local, 08:00 UTC", () => {
  assert.equal(new Date(UTC6_FROM_MS).toISOString(), "2026-11-01T08:00:00.000Z");
  assert.equal(edmontonZoneAt(UTC6_FROM_MS - 1), "America/Edmonton");
  assert.equal(edmontonZoneAt(UTC6_FROM_MS), "Etc/GMT+6");
});

test("instants either side of the cutover read UTC−6, and earlier ones keep their rules", () => {
  assert.equal(time.format(new Date("2026-11-01T07:59:00Z")), "Nov 1, 1:59 a.m."); // MDT
  assert.equal(time.format(new Date("2026-11-01T08:00:00Z")), "Nov 1, 2:00 a.m."); // not 1:00 a.m. again
  assert.equal(time.format(new Date("2026-11-20T02:00:00Z")), "Nov 19, 8:00 p.m."); // a true-UTC story
  assert.equal(time.format(new Date("2027-01-15T18:00:00Z")), "Jan 15, 12:00 p.m.");
  assert.equal(time.format(new Date("2026-10-15T18:00:00Z")), "Oct 15, 12:00 p.m."); // MDT, unchanged
  assert.equal(time.format(new Date("2026-01-15T18:00:00Z")), "Jan 15, 11:00 a.m."); // MST, unchanged
});

test("no zone name ever reaches the page", () => {
  const parts = time.formatToParts(new Date("2026-11-20T02:00:00Z"));
  assert.ok(!parts.some((p) => p.type === "timeZoneName"));
  assert.doesNotMatch(time.format(new Date("2026-11-20T02:00:00Z")), /MST|MDT|CST|GMT|UTC|MT\b/);
});

test("Feed.tsx formats through the helper only, with no literal zone suffix", () => {
  const code = readFileSync(new URL("../src/components/Feed.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(code, /\}\s*MT\b/);
  assert.doesNotMatch(code, /America\/Edmonton/);
});

test("GamesCalendar.tsx holds no raw America/Edmonton literal — only the imported constant", () => {
  const code = readFileSync(new URL("../src/components/GamesCalendar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(code, /["']America\/Edmonton["']/);
});

test("GamesCalendar.tsx drops the zone name for the fixed UTC-6 zone", () => {
  const code = readFileSync(new URL("../src/components/GamesCalendar.tsx", import.meta.url), "utf8");
  assert.match(code, /fixed \? \{\} : \{ timeZoneName: "short"/);
  // What that branch prints, for a Calgary kickoff after the cutover.
  const label = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: edmontonZoneAt(Date.parse("2026-11-07T21:00:00Z")) })
    .format(new Date("2026-11-07T21:00:00Z"));
  assert.equal(`${label} local`, "3:00 p.m. local");
});
