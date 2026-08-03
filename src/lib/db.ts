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
