-- PitchRoots v2 schema (Neon Postgres)
create extension if not exists pg_trgm;

create table if not exists sources (
  id serial primary key,
  name text not null,
  feed_url text not null unique,
  home_url text not null,
  tier text not null check (tier in ('national-team','pro-league','semi-pro','media','independent','provincial')),
  -- media-tier feeds carry lots of non-Canadian soccer; the classifier gates harder on them
  media_gate boolean not null default false,
  -- some CDNs drop non-browser UAs; null = default honest UA
  ua_override text,
  -- regex rewrite applied to item links before verification (some feeds emit
  -- systematically broken paths, e.g. Daily Hive's /offside/ links 404)
  link_rewrite_from text,
  link_rewrite_to text,
  active boolean not null default true,
  last_polled_at timestamptz,
  last_ok_at timestamptz,
  fail_count int not null default 0
);

create table if not exists items (
  id bigserial primary key,
  source_id int not null references sources(id),
  guid text not null,
  url text not null,
  canonical_url text not null unique,
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  published_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create index if not exists items_pub_idx on items (published_at desc);
create index if not exists items_tags_idx on items using gin (tags);
create index if not exists items_title_trgm_idx on items using gin (lower(title) gin_trgm_ops);
create unique index if not exists items_source_guid_idx on items (source_id, guid);

-- Items the classifier rejected — remembered so they aren't re-classified every run.
create table if not exists rejections (
  source_id int not null references sources(id),
  guid text not null,
  rejected_at timestamptz not null default now(),
  primary key (source_id, guid)
);

-- Per-run ingestion summary. Resonate GCs completed promises after ~24h, so the
-- durable run's own result is not a durable history. This append-only log keeps
-- run-level stats for feed-health debugging. Keyed on the run's origin promise id
-- so a replayed final step upserts the same row instead of appending a duplicate.
create table if not exists run_log (
  origin_id text primary key,
  ran_at timestamptz not null default now(),
  sources int, published int, classified int, dead_links int, dropped int,
  per_source jsonb
);
create index if not exists run_log_ran_at_idx on run_log (ran_at desc);

insert into sources (name, feed_url, home_url, tier, media_gate, ua_override) values
  ('Canada Soccer', 'https://canadasoccer.com/news/feed?lang=en', 'https://news.canadasoccer.com', 'national-team', false, null),
  ('Sportsnet Soccer', 'https://www.sportsnet.ca/soccer/feed/', 'https://www.sportsnet.ca/soccer/', 'media', true, null),
  ('Northern Tribune', 'https://northerntribune.ca/feed/', 'https://northerntribune.ca', 'independent', false,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('League1 Ontario', 'https://league1ontario.com/feed', 'https://league1ontario.com', 'semi-pro', false, null),
  ('CBC Soccer', 'https://www.cbc.ca/webfeed/rss/rss-sports-soccer', 'https://www.cbc.ca/sports/soccer', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Alberta Soccer', 'https://www.albertasoccer.com/feed', 'https://www.albertasoccer.com', 'provincial', false, null),
  ('Soccer Nova Scotia', 'https://soccerns.ca/feed', 'https://soccerns.ca', 'provincial', false, null),
  ('Daily Hive Offside', 'https://www.dailyhive.com/feed/offside', 'https://dailyhive.com/channel/offside', 'media', true, null)
on conflict (feed_url) do nothing;

alter table sources add column if not exists link_rewrite_from text;
alter table sources add column if not exists link_rewrite_to text;
update sources set link_rewrite_from = '^https://dailyhive\.com/offside/', link_rewrite_to = 'https://dailyhive.com/canada/'
  where feed_url = 'https://www.dailyhive.com/feed/offside' and link_rewrite_from is null;

-- 2026-08-02 ── registry expansion. See SOURCE-REVIEW-2026-08.md.

-- canadasoccer.com/feed answers 200 with an empty channel, so it never tripped the
-- failure path and sat silent. The base insert above now carries the live newsroom
-- feed instead. That feed is bilingual, publishing each story twice; ?lang=en drops
-- the French duplicates, which the trigram dedupe can't catch (a FR/EN pair shares
-- no title text).
--
-- Retire the legacy row. It never published, so nothing references it — and the
-- `not exists` guard means this is a no-op rather than a foreign-key error if that
-- ever stops being true.
delete from sources s
 where s.feed_url = 'https://www.canadasoccer.com/feed'
   and not exists (select 1 from items i where i.source_id = s.id)
   and not exists (select 1 from rejections r where r.source_id = s.id);

-- Dedicated Canadian-soccer outlets. Native to the beat, so no media gate — the
-- hard gate would only spend classify calls to confirm what the source already is.
insert into sources (name, feed_url, home_url, tier, media_gate, ua_override) values
  ('TrueNorthFoot', 'https://truenorthfoot.ca/feed', 'https://truenorthfoot.ca', 'independent', false, null),
  ('The Third Sub', 'https://thethirdsub.ca/feed', 'https://thethirdsub.ca', 'independent', false, null),
  ('AFTN', 'https://www.aftn.ca/feed', 'https://www.aftn.ca', 'independent', false, null),
  ('Waking The Red', 'https://wakingthered.com/feed', 'https://wakingthered.com', 'independent', false, null)
on conflict (feed_url) do nothing;

-- Regional newspaper soccer desks — the route into smaller markets that have no
-- soccer-native outlet. Gated: these carry mostly European club football.
-- Postmedia titles and the Globe serve a 1-item stub to a non-browser UA, so the
-- override isn't optional for them.
insert into sources (name, feed_url, home_url, tier, media_gate, ua_override) values
  ('Edmonton Journal Soccer', 'https://edmontonjournal.com/category/sports/soccer/feed', 'https://edmontonjournal.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Calgary Herald Soccer', 'https://calgaryherald.com/category/sports/soccer/feed', 'https://calgaryherald.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('The Province Soccer', 'https://theprovince.com/category/sports/soccer/feed', 'https://theprovince.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Toronto Sun Soccer', 'https://torontosun.com/category/sports/soccer/feed', 'https://torontosun.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Windsor Star Soccer', 'https://windsorstar.com/category/sports/soccer/feed', 'https://windsorstar.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Sudbury Star Soccer', 'https://thesudburystar.com/category/sports/soccer/feed', 'https://thesudburystar.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Sault Star Soccer', 'https://saultstar.com/category/sports/soccer/feed', 'https://saultstar.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Kingston Whig-Standard Soccer', 'https://thewhig.com/category/sports/soccer/feed', 'https://thewhig.com/category/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Globe and Mail Soccer', 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/sports/soccer/', 'https://www.theglobeandmail.com/sports/soccer/', 'media', true,
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
  ('Winnipeg Free Press Soccer', 'https://winnipegfreepress.com/rss/?path=/sports/soccer', 'https://www.winnipegfreepress.com/sports/soccer/', 'media', true, null),
  ('Toronto Star Soccer', 'https://www.thestar.com/search/?f=rss&t=article&c=sports/soccer', 'https://www.thestar.com/sports/soccer/', 'media', true, null)
on conflict (feed_url) do nothing;
