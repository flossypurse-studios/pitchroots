// Which fetched entries are new enough to ingest. Plain JS with no imports, so
// the Edge Function uses it and `node scripts/assert-connectors.mjs` tests it.
//
// Two cutoffs, the later one wins:
//   - the rolling window every source has (maxAgeDays, 7), and
//   - the source's own `not_before`, a fixed timestamp. A migration that adds a
//     source sets it to now() - 48h on insert, so the first run takes only the
//     last two days of stories and the social mirror posts one or two, never a
//     backfill of the source's archive (SPEC §8.4). Because it is FIXED, it
//     stops mattering once it is older than the rolling window: it is not a
//     permanent 48h max age, and an outage longer than two days loses nothing.
//     null (every RSS source) leaves the rolling window as the only cutoff.
//
// Pure: `nowMs` and `notBefore` must both come from checkpointed values (the
// ctx.run'd Date.now() and the source row), so a replay filters identically.
// notBefore may be a Date (fresh from postgres) or an ISO string (the same row
// after a checkpoint round-trip); both give the same instant.
export function freshEntries(entries, nowMs, maxAgeDays, notBefore) {
  let cutoff = nowMs - maxAgeDays * 86_400_000;
  if (notBefore != null) {
    const nb = new Date(notBefore).getTime();
    if (Number.isNaN(nb)) throw new Error(`source.badNotBefore: ${String(notBefore)}`);
    if (nb > cutoff) cutoff = nb;
  }
  return entries.filter((e) => Date.parse(e.publishedAt) >= cutoff);
}
