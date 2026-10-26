-- 2026-10-26 — first non-RSS source: the Canadian Premier League's news.
--
-- canpl.ca now 302s to www.cplsoccer.com, which has no RSS feed. Its pages are
-- rendered from a Deltatre Forge content API on dapi.cplsoccer.com; the
-- `stories` endpoint returns the same stories, newest first, as JSON. The
-- `forge` connector in supabase/functions/poll/connectors.mjs reads it and yields
-- the same item shape as an RSS item, so everything downstream is unchanged.
-- Checked 2026-10-26: www.cplsoccer.com/robots.txt allows /news (it disallows
-- only /assets/, /_showcase/, /_libraries/, /errors/, /_test, /template,
-- /_mobileapp and signin); dapi.cplsoccer.com/robots.txt is a 404 (nothing
-- disallowed); the site's "Terms of use" footer link points at /terms-test,
-- which 404s, so no published terms exist to check against.
--
-- ORDER MATTERS: deploy the poll function from this branch FIRST, then apply
-- this file. A build without fetchSource() would read the new row as RSS, parse
-- the JSON to zero items, and count it as a quiet empty feed instead of failing.
-- The new build reads a missing `connector` column as 'rss', so deploying before
-- the column exists is safe.
--
-- DO NOT RUN THIS AGAINST PRODUCTION WITHOUT REVIEW. Written for the operator to
-- apply by hand. Idempotent: a second run changes nothing.
begin;

-- Which parser reads feed_url: 'rss' (fetchFeed in index.ts) or a key of
-- CONNECTORS in connectors.mjs. Add a value here when a new connector lands.
alter table sources add column if not exists connector text not null default 'rss';
alter table sources drop constraint if exists sources_connector_check;
alter table sources add constraint sources_connector_check check (connector in ('rss', 'forge'));

-- Items published before not_before are never ingested, so never mirrored
-- (poll/freshness.mjs). NULL, the default, changes nothing for any existing
-- source. A newly added source sets it to now() - 48h on insert so its first run
-- takes only the last two days of stories, not its archive (SPEC §8.4: never a
-- backfill). It is a fixed instant, not a max age: once it is older than the
-- 7-day window it no longer filters anything.
alter table sources add column if not exists not_before timestamptz;

-- $limit=30: ~a week of league stories in-season (30 returned 2026-10-26 spanned
-- 2026-10-19 → 10-26), and ingestSource keeps only the last 7 days and at most
-- 12 new per run anyway. home_url is where the connector builds article links
-- (<home_url>/news/<slug>) and what the logo fetcher reads. Not media-gated: the
-- league's own newsroom is native to the beat, like the independents.
-- not_before = now() - 48h (Cully's call 2026-10-26): the first run ingests, and
-- the Bluesky mirror posts, only the last two days of CanPL stories (one or two),
-- not the ~27 older ones the API returns. Set once, at insert; a re-run of this
-- file hits `on conflict do nothing` and leaves it alone.
insert into sources (name, feed_url, home_url, tier, media_gate, ua_override, connector, not_before) values
  ('CanPL', 'https://dapi.cplsoccer.com/v2/content/en-us/stories?$limit=30', 'https://www.cplsoccer.com', 'pro-league', false, null, 'forge', now() - interval '48 hours')
on conflict (feed_url) do nothing;

commit;
