// Alberta's time zone, right whether the runtime's tz data is old or new.
//
// Alberta moved to permanent UTC-6: it did not fall back on 2026-11-01 at 02:00
// local (08:00 UTC), and stays at -06 from then on (IANA tzdb 2026c). Node, Deno
// and Postgres here all carry older data that still says MST (-07) after that
// instant, an hour wrong. So the zone is picked per instant: America/Edmonton
// before the cutover (old and new data agree there), the fixed zone Etc/GMT+6
// from it on (POSIX sign: Etc/GMT+6 is UTC-6). Never print its abbreviation:
// old data calls it "MST", Etc/GMT+6 calls it "GMT-6", and both read wrong.
//
// Pure, so tests/edmontonZone.test.mts runs it.

export const EDMONTON = "America/Edmonton";
export const UTC6_FROM_MS = Date.UTC(2026, 10, 1, 8); // 2026-11-01T08:00:00Z
const FIXED_UTC6 = "Etc/GMT+6";

/** The IANA zone to format `utcMs` in, for Alberta local time. */
export function edmontonZoneAt(utcMs: number): string {
  return utcMs >= UTC6_FROM_MS ? FIXED_UTC6 : EDMONTON;
}

export type ZonedFormat = { format(d: Date): string; formatToParts(d: Date): Intl.DateTimeFormatPart[] };

/** An Intl.DateTimeFormat look-alike in Alberta local time. `opts` must not
 * set timeZone or timeZoneName. */
export function edmontonFormat(locale: string, opts: Intl.DateTimeFormatOptions): ZonedFormat {
  const before = new Intl.DateTimeFormat(locale, { ...opts, timeZone: EDMONTON });
  const after = new Intl.DateTimeFormat(locale, { ...opts, timeZone: FIXED_UTC6 });
  const pick = (d: Date) => (d.getTime() >= UTC6_FROM_MS ? after : before);
  return {
    format: (d) => pick(d).format(d),
    formatToParts: (d) => pick(d).formatToParts(d),
  };
}
