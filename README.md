# PitchRoots

[pitchroots.ca](https://pitchroots.ca) — Canadian soccer, one feed.

A curated Canada-wide soccer news feed: headlines with short original summaries,
tagged by league, national team, and province, always linking out to the original
publisher. No accounts, no paywall — just the feed and [RSS](https://pitchroots.ca/feed.xml).

## How it works

- An hourly `pg_cron` job invokes a durable [Resonate](https://resonatehq.io)
  workflow (`supabase/functions/poll`), which fans out to each source in the
  registry. Every external call is its own checkpoint, so a crash resumes where it
  stopped instead of restarting the run.
- New items are deduped (per-source GUID, canonical URL, near-identical titles via
  `pg_trgm`), link-verified, then classified and summarized by Claude Haiku against a
  fixed tag vocabulary. Items that aren't about Canadian soccer are dropped and
  remembered so they're never reclassified.
- Pages are statically rendered and revalidate every 15 minutes.

See [how it works](https://pitchroots.ca/how-it-works) for the longer version.

## Stack

- [Next.js](https://nextjs.org) (App Router) on Vercel, Tailwind CSS v4
- [Supabase](https://supabase.com) Postgres (`db/schema.sql`) + `pg_cron` + an Edge
  Function worker running the durable write loop
- [Anthropic API](https://platform.claude.com) (Haiku) for classify/summarize

## Development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

The write loop runs as a Supabase Edge Function, not in the Next.js app. To trigger
a run by hand, invoke it durably from psql:

```sql
select resonate.invoke('poll-manual-1', 'poll', '[]'::jsonb,
  'https://<project-ref>.functions.supabase.co/poll');
```

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (pooler) |
| `SITE_URL` | Canonical site origin (defaults to `https://pitchroots.ca`) |
| `REVALIDATE_SECRET` | Bearer token the worker uses to call `/api/revalidate` |

The worker's own secrets (`ANTHROPIC_API_KEY`, `SUPABASE_DB_URL`, `REVALIDATE_URL`,
`REVALIDATE_SECRET`) are set on the Edge Function, not on the web app.

## For publishers

We link out prominently and never republish article text or images. If you run a
source we cover and want your coverage adjusted or removed, email
[hello@pitchroots.ca](mailto:hello@pitchroots.ca).
