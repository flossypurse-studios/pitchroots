import postgres from "postgres";

// Read-loop data access. Points at the Supabase Postgres that also hosts the
// durable ingestion engine (resonate-pg) — one database for the whole system.
// prepare:false + max:1 is the Supabase-pooler-safe setting (transaction-mode
// pooling rejects prepared statements). A module-level singleton is reused
// across warm serverless invocations.
let _sql: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _sql = postgres(url, { prepare: false, max: 1 });
  return _sql;
}

export type FeedItem = {
  id: number;
  source_name: string;
  source_home: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  published_at: Date;
  // Other outlets that ran the same story. The item's own source is excluded, so
  // this is empty for the common single-outlet case.
  also: { name: string; url: string }[];
};

export type Game = {
  id: number;
  competition: string;
  name: string;
  home_team: string | null;
  away_team: string | null;
  kickoff_at: Date;
  timezone: string | null;
  venue: string | null;
  city: string | null;
  province: string | null;
  ticket_url: string;
  status: string;
};

// The competitions the calendar renders. Everything else in `games` (friendlies
// we can't map, reserve sides) is stored but stays off the page until the
// mapping in the worker deliberately widens.
const GAME_COMPETITIONS = ["mls", "canpl", "nsl", "canmnt", "canwnt", "canadian-championship"];

export async function upcomingGames(
  opts: { competition?: string; limit?: number } = {},
): Promise<Game[]> {
  const q = sql();
  const limit = opts.limit ?? 200;
  // Kickoff minus 4h keeps today's game on the page until it's over; canceled
  // and postponed events drop out (a postponed game has no trustworthy date).
  const rows = await q`
    select id, competition, name, home_team, away_team, kickoff_at, timezone,
           venue, city, province, ticket_url, status
    from games
    where kickoff_at >= now() - interval '4 hours'
      and status not in ('canceled', 'cancelled', 'postponed')
      and competition = any(${opts.competition ? [opts.competition] : GAME_COMPETITIONS})
    order by kickoff_at asc
    limit ${limit}`;
  return rows as unknown as Game[];
}

// The competitions that currently have upcoming games — drives which game-tag
// pills, footer links, and sitemap entries exist, so no surface ever links to
// an empty competition page. Never throws (used in the layout).
export async function gameCompetitionsPresent(): Promise<string[]> {
  try {
    const q = sql();
    const rows = (await q`
      select distinct competition from games
      where kickoff_at >= now()
        and status not in ('canceled', 'cancelled', 'postponed')
        and competition = any(${GAME_COMPETITIONS})`) as { competition: string }[];
    return rows.map((r) => r.competition);
  } catch {
    return [];
  }
}

// Gates the nav pill, footer link, and sitemap entry: the calendar surfaces
// sitewide only once it has something to show. Never throws — a read failure
// hides the link rather than breaking every page's layout.
export async function hasUpcomingGames(): Promise<boolean> {
  try {
    const q = sql();
    const [row] = await q`
      select 1 as present from games
      where kickoff_at >= now()
        and status not in ('canceled', 'cancelled', 'postponed')
        and competition = any(${GAME_COMPETITIONS})
      limit 1`;
    return Boolean(row);
  } catch {
    return false;
  }
}

export type ItemCard = { title: string; source_name: string; tags: string[] };

// The three fields the social card sets in type, by item id. Deliberately its own
// narrow query rather than a filter over latestItems: the card endpoint is reached
// once per item and then cached forever, and it has no business pulling summaries,
// citation aggregates, or the hundred most recent rows to render one headline.
export async function itemCard(id: number): Promise<ItemCard | null> {
  const q = sql();
  const rows = await q`
    select i.title, s.name as source_name, i.tags
    from items i join sources s on s.id = i.source_id
    where i.id = ${id}`;
  return (rows[0] as ItemCard | undefined) ?? null;
}

export async function latestItems(opts: { tag?: string; limit?: number } = {}): Promise<FeedItem[]> {
  const q = sql();
  const limit = opts.limit ?? 100;
  const rows = opts.tag
    ? await q`
        select i.id, s.name as source_name, s.home_url as source_home,
               i.url, i.title, i.summary, i.tags, i.published_at,
               coalesce((
                 select json_agg(json_build_object('name', s2.name, 'url', x.url)
                                 order by x.published_at)
                 from item_sources x join sources s2 on s2.id = x.source_id
                 where x.item_id = i.id and x.source_id <> i.source_id
               ), '[]'::json) as also
        from items i join sources s on s.id = i.source_id
        where ${opts.tag} = any(i.tags)
        order by i.published_at desc limit ${limit}`
    : await q`
        select i.id, s.name as source_name, s.home_url as source_home,
               i.url, i.title, i.summary, i.tags, i.published_at,
               coalesce((
                 select json_agg(json_build_object('name', s2.name, 'url', x.url)
                                 order by x.published_at)
                 from item_sources x join sources s2 on s2.id = x.source_id
                 where x.item_id = i.id and x.source_id <> i.source_id
               ), '[]'::json) as also
        from items i join sources s on s.id = i.source_id
        order by i.published_at desc limit ${limit}`;
  return rows as unknown as FeedItem[];
}
