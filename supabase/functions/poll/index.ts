// PitchRoots durable ingestion pipeline — the write-loop, on Resonate.
//
// This is the same fetch → dedupe → verify → classify → insert pipeline that
// used to run as a single Next.js cron route, re-expressed as a *durable*
// Resonate function running on resonate-pg (the Resonate server living entirely
// inside this Supabase Postgres).
//
// The whole point: every expensive or flaky external call is its own
// `ctx.run(...)` checkpoint. If an invocation dies mid-run — Edge Function
// timeout, redeploy, crash — the next invocation replays the function, and each
// completed step returns instantly from Postgres instead of re-executing. So we
// never re-fetch a feed we already read, and — critically — we never re-pay
// Claude to classify an article we already classified.
//
// Semantics are exactly-once *checkpointing*, at-least-once *side effects*. That
// is a clean fit here because the item/rejection writes are idempotent: every
// insert is `on conflict do nothing`, and `rejections` has a composite primary
// key, so a replayed step can never create a duplicate row. The one exception is
// markSourceFail's `fail_count + 1` — a best-effort health counter that can
// over-count by one if its step replays; nothing depends on its exact value.
import { type Context, Resonate } from "jsr:@resonatehq/supabase@0.4.1";
import Anthropic from "npm:@anthropic-ai/sdk@^0.111";
import postgres from "npm:postgres@^3.4.5";
import { XMLParser } from "npm:fast-xml-parser@^5.10.1";

const resonate = new Resonate();
const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// postgres.js over the Supabase pooler: prepare:false + max:1 is the pooler-safe
// setting (transaction-mode pooling rejects prepared statements).
// Supabase's managed SUPABASE_DB_URL is a *direct* connection (5432), which has a
// hard max_connections ceiling — with one invocation per source each holding a
// connection, a fan-out wide enough to be useful hits "remaining connection slots are
// reserved" and silently drops sources. PITCHROOTS_DB_URL points at the transaction
// pooler (6543) instead, which is what prepare:false + max:1 was always for. Falls
// back to the direct URL so a fresh deploy without the secret still runs.
const sql = postgres(
  Deno.env.get("PITCHROOTS_DB_URL") ?? Deno.env.get("SUPABASE_DB_URL")!,
  { prepare: false, max: 1 },
);

const DEFAULT_UA = "Mozilla/5.0 (compatible; PitchRoots/1.0; +https://pitchroots.ca)";
const MAX_ITEM_AGE_DAYS = 7;
// Per-source cap. In the old single-pass loop this was one global cap of 40;
// now that sources fan out and run concurrently, the fair unit is per-source.
const MAX_NEW_PER_SOURCE = 12;
// Consecutive whole-poll failures before a source is auto-parked (active=false).
// ~24 ≈ a day of hourly failures; recheckDisabledSources heals it when it recovers.
const FAIL_DISABLE_THRESHOLD = 24;
// How many sources ingest concurrently. Each one is a separate Edge Function
// invocation holding a Postgres connection, so this is really a connection-pool
// budget, not a throughput knob. Raise only alongside the pool.
const FANOUT = 6;

// Canonical tag vocabulary — MUST stay in lockstep with web/src/lib/tags.ts.
// (The Edge Function can't import from the Next app; this is the one duplication,
// and it's a flat list of slugs, so drift is easy to eyeball in review.)
const TAG_SLUGS = [
  "canmnt", "canwnt", "canpl", "nsl", "mls", "league1", "world-cup",
  "canadian-championship", "womens", "youth", "alberta", "british-columbia",
  "saskatchewan", "manitoba", "ontario", "quebec", "new-brunswick",
  "nova-scotia", "prince-edward-island", "newfoundland-labrador",
];

type SourceRow = {
  id: number;
  name: string;
  feed_url: string;
  home_url: string;
  tier: string;
  media_gate: boolean;
  ua_override: string | null;
  link_rewrite_from: string | null;
  link_rewrite_to: string | null;
};

type Candidate = {
  guid: string;
  url: string;
  canonicalUrl: string;
  title: string;
  snippet: string;
  publishedAt: string; // ISO — must be JSON-serializable to survive checkpointing
};

type Classification = { relevant: boolean; tags: string[]; summary: string };

type SourceStats = {
  source: string;
  fetched: number;
  deadLinks: number;
  classified: number;
  published: number;
  attached: number;
  dropped: number;
  error?: string;
};

// ── pure helpers (identical logic to the original pipeline) ──────────────────

function canonicalize(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|cmp$|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── side-effecting steps (each wrapped in ctx.run at the call site) ──────────

async function fetchFeed(source: SourceRow): Promise<Candidate[]> {
  const res = await fetch(source.feed_url, {
    headers: {
      "User-Agent": source.ua_override ?? DEFAULT_UA,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata" });
  const doc = parser.parse(xml);

  // A feed value arrives as a bare string, a CDATA/#text wrapper, or an array of
  // either — repeated elements always parse to an array. WordPress feeds commonly
  // emit several <link> elements per item (the real permalink plus empty
  // app-deep-link placeholders), so take the first entry that carries any text.
  const text = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v)) {
      for (const el of v) {
        const t = text(el);
        if (t) return t;
      }
      return "";
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      return text(o.__cdata ?? o["#text"] ?? "");
    }
    return String(v).trim();
  };

  // Atom — and some RSS — carry the URL in an @_href attribute instead of the
  // element body. Prefer rel="alternate"; ignore entries with no usable href so a
  // placeholder element can't shadow the real link.
  const href = (v: unknown): string => {
    const arr = Array.isArray(v) ? v : [v];
    const withHref = arr.filter(
      (x): x is Record<string, unknown> =>
        !!x && typeof x === "object" &&
        typeof (x as Record<string, unknown>)["@_href"] === "string",
    );
    const alt = withHref.find((x) => x["@_rel"] === "alternate") ?? withHref[0];
    return String(alt?.["@_href"] ?? "").trim();
  };

  const rssItems = doc?.rss?.channel?.item;
  const atomEntries = doc?.feed?.entry;
  const raw: Record<string, unknown>[] = rssItems
    ? Array.isArray(rssItems) ? rssItems : [rssItems]
    : atomEntries
      ? Array.isArray(atomEntries) ? atomEntries : [atomEntries]
      : [];

  const out: Candidate[] = [];
  for (const it of raw) {
    const link = text(it.link) || href(it.link);
    const title = stripHtml(text(it.title));
    if (!link || !title) continue;
    const guid = text(it.guid) || text(it.id) || link;
    const pub = text(it.pubDate) || text(it.published) || text(it.updated) || text(it["dc:date"]);
    const publishedAt = pub ? new Date(pub) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;
    const snippet = stripHtml(
      text(it.description) || text(it.summary) || text(it["content:encoded"]) || text(it.content),
    ).slice(0, 600);
    out.push({
      guid,
      url: link,
      canonicalUrl: canonicalize(link),
      title,
      snippet,
      publishedAt: publishedAt.toISOString(),
    });
  }
  return out;
}

// A link must resolve before we publish it. Applies the source's rewrite rule,
// rejects hard-dead links (404/410/DNS), follows redirects, and adopts the
// page's same-host rel=canonical. WAF blocks / transient errors get the benefit
// of the doubt — the link usually works for a human even when it doesn't for us.
async function verifyLink(
  source: SourceRow,
  rawUrl: string,
): Promise<{ ok: boolean; url: string }> {
  let url = rawUrl;
  if (source.link_rewrite_from && source.link_rewrite_to) {
    url = url.replace(new RegExp(source.link_rewrite_from), source.link_rewrite_to);
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": source.ua_override ?? DEFAULT_UA },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (res.status === 404 || res.status === 410) return { ok: false, url };
    let finalUrl = res.url || url;
    if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) {
      const head = (await res.text()).slice(0, 200_000);
      const m =
        head.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ??
        head.match(/<link[^>]*href="([^"]+)"[^>]*rel="canonical"/i);
      if (m) {
        try {
          const canon = new URL(m[1], finalUrl);
          if (canon.hostname.replace(/^www\./, "") === new URL(finalUrl).hostname.replace(/^www\./, "")) {
            finalUrl = canon.toString();
          }
        } catch {
          /* malformed canonical — keep finalUrl */
        }
      }
    }
    return { ok: true, url: finalUrl };
  } catch (err) {
    if (err instanceof Error && /ENOTFOUND|ECONNREFUSED/.test(String((err as Error).cause ?? err.message))) {
      return { ok: false, url };
    }
    return { ok: true, url }; // transient — benefit of the doubt
  }
}

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_item",
  description: "Record the classification of one news item for a Canada-wide soccer news feed.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      relevant: {
        type: "boolean",
        description:
          "True only if the item is about Canadian soccer: a Canadian team, league, competition, player, or Canadian soccer governance.",
      },
      tags: {
        type: "array",
        items: { type: "string", enum: TAG_SLUGS },
        description: "Zero or more applicable tags from the fixed vocabulary.",
      },
      summary: {
        type: "string",
        description:
          "One to two plain factual sentences in your own words. Never copy source phrasing. Empty string if not relevant.",
      },
    },
    required: ["relevant", "tags", "summary"],
    additionalProperties: false,
  },
};

async function classify(source: SourceRow, c: Candidate): Promise<Classification> {
  // Both non-soccer items that reached the feed — a PWHL story and a junior-hockey
  // story — came from newspaper desks filing another sport into their soccer
  // category, and both carried a Canadian angle strong enough to satisfy a gate that
  // only asked "is this Canadian?". So the sport test runs first and names the sports
  // that actually leak; Canadian relevance is the second question, never the first.
  const gate = source.media_gate
    ? "This source is a general sports outlet and its soccer section sometimes contains other sports. Apply two tests, in this order. " +
      "FIRST — is this association football (soccer)? Ice hockey (NHL, PWHL, CHL, Memorial Cup, Centennial Cup), Canadian or American football, basketball, baseball, golf, curling, and tennis are NOT soccer, however Canadian the story is. A trophy or tournament name alone does not make something soccer. " +
      "SECOND — does it involve a Canadian team, league, competition, or Canadian player? Generic international soccer coverage is NOT relevant. " +
      "If you cannot tell which sport an item is about, it is NOT relevant."
    : "This source covers Canadian soccer: default to relevant unless the item is clearly not about association football (soccer).";
  const response = await claude.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_item", disable_parallel_tool_use: true },
    system:
      "You curate PitchRoots, a Canada-wide soccer news feed. You classify one item at a time. " +
      "Summaries are neutral, factual, 1-2 sentences, written entirely in your own words — never reuse the source's phrasing. No hype, no editorializing. " +
      "Club-to-league map (only tag a league the story actually involves): " +
      "mls = Toronto FC, Vancouver Whitecaps, CF Montréal. " +
      "canpl = Atlético Ottawa, Cavalry FC, Forge FC, Halifax Wanderers, Pacific FC, Valour FC, Vancouver FC, York United. " +
      "nsl = AFC Toronto, Calgary Wild, Halifax Tides, Montreal Roses, Ottawa Rapid, Vancouver Rise. " +
      "Tag provinces only for stories with a clear provincial/city angle. " +
      "The URL is evidence of the section the publisher filed the story under — a path like /sports/hockey/ is a strong signal, but weigh it against the headline, since a soccer story can be filed under another sport's section when it involves that sport's people. " +
      gate,
    messages: [
      {
        role: "user",
        content: `Source: ${source.name} (tier: ${source.tier})\nTitle: ${c.title}\nURL: ${c.url}\nPublished: ${c.publishedAt}\nExcerpt: ${c.snippet || "(none)"}`,
      },
    ],
  });
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) throw new Error(`no tool_use block (stop_reason=${response.stop_reason})`);
  return block.input as Classification;
}

const SAME_STORY_TOOL: Anthropic.Tool = {
  name: "same_story",
  description: "Judge whether two headlines describe the same underlying news event.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      same: {
        type: "boolean",
        description:
          "True only if both describe the SAME single event — the same match, the same signing, the same announcement. Two previews of different fixtures, or a men's and a women's edition of the same weekly column, are DIFFERENT events. A report that a club is 'in talks' or 'approaching' a transfer is NOT the same event as a confirmed signing announcement — they describe different moments in a process.",
      },
    },
    required: ["same"],
    additionalProperties: false,
  },
};

// Title similarity is a candidate filter, never the decision. The corpus contains
// boilerplate headline templates that score higher than genuine matches do —
// "PSL Canada Mens Review: Week 15" vs the Womens edition scores 0.85, and two
// different match previews score 0.62, while a real cross-outlet pair on the same
// signing scores 0.64. No threshold separates them, so a model settles it.
async function isSameStory(a: Candidate, b: { title: string; summary: string }): Promise<boolean> {
  const response = await claude.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    tools: [SAME_STORY_TOOL],
    tool_choice: { type: "tool", name: "same_story", disable_parallel_tool_use: true },
    system:
      "You group Canadian soccer news. Two items are the same story only when they report the same single event. " +
      "Beware near-identical wording that describes different events: recurring columns (weekly reviews, match previews) " +
      "share almost all their words while covering different fixtures or different teams. " +
      "A report and a follow-up analysis of the same match ARE the same story. " +
      // A rumour and its confirmation share almost every word, and the confirmation is
      // the more newsworthy of the two — so merging them discards the better story.
      // Measured at 0.72 title similarity, this failed roughly half the time, and
      // always in the orientation production actually uses (existing item first).
      "A rumour or report that a club is in talks about a transfer is a DIFFERENT event from a confirmed " +
      "signing announcement — keep them separate. " +
      // Matching on body text raised recall sharply but pulled in pairs that merely
      // share a club and a week. The two that actually mislead: a preview and a
      // report of the same fixture (merging them files a finished match under a
      // preview headline, since the earlier item becomes the card), and recurring
      // roundup columns, which mention a story without being about it.
      "An item written BEFORE a match — a preview, projected lineups, a ticket or attendance story — is a " +
      "DIFFERENT event from one written AFTER it, such as a report, reaction, or player quotes. " +
      "A recurring roundup column that gathers several topics under a standing title and a date is never the " +
      "same event as a specific news story, even when it mentions that story. " +
      "When genuinely unsure, answer false — " +
      "wrongly merging two stories loses one of them, which is worse than showing both.",
    messages: [
      {
        role: "user",
        content:
          `A: ${a.title}\n${a.snippet || "(no excerpt)"}\n\n` +
          `B: ${b.title}\n${b.summary}`,
      },
    ],
  });
  const block = response.content.find(
    (bl): bl is Anthropic.ToolUseBlock => bl.type === "tool_use",
  );
  if (!block) throw new Error(`no tool_use block (stop_reason=${response.stop_reason})`);
  return Boolean((block.input as { same: boolean }).same);
}

// ── durable functions ────────────────────────────────────────────────────────

// poll() — the top-level durable run. Reads the active sources, then fans each
// one out as its own child invocation (ctx.rpc). The parent suspends — holding
// zero compute — until every source settles, then pings the site to revalidate
// if anything new was published.
resonate.register("poll", async function poll(ctx: Context) {
  const sources = (await ctx.run(() => getActiveSources())) as SourceRow[];

  // Fan out per source in bounded waves rather than all at once. Each ingestSource
  // is its own Edge Function invocation holding its own Postgres connection, so an
  // unbounded fan-out exhausts the connection pool as the registry grows — at 23
  // sources it already did, losing two feeds per run to "remaining connection slots
  // are reserved". FANOUT is a constant and the source list is checkpointed, so wave
  // membership is identical on every replay.
  const results: SourceStats[] = [];
  for (let i = 0; i < sources.length; i += FANOUT) {
    const wave = await Promise.all(
      sources.slice(i, i + FANOUT).map(async (s) => {
        try {
          return await ctx.rpc("ingestSource", s);
        } catch (err) {
          return {
            source: s.name, fetched: 0, deadLinks: 0, classified: 0,
            published: 0, attached: 0, dropped: 0, error: String(err),
          } as SourceStats;
        }
      }),
    ) as SourceStats[];
    results.push(...wave);
  }

  const published = results.reduce((n, r) => n + r.published, 0);
  const attached = results.reduce((n, r) => n + r.attached, 0);
  // Attaching a late-arriving outlet to an existing card changes what renders, so
  // it earns a revalidate just as a new item does — otherwise a citation added
  // hours after publication waits for the ISR timer.
  if (published + attached > 0) await ctx.run(() => triggerRevalidate());

  // The mirror runs LAST — after persistence, after clustering, after the revalidate
  // ping — and never inside ingestSource, because until every source has settled a
  // story can still turn out to be one another outlet already ran and be merged away.
  // A card that loses its own page is a no-op; a post that shouldn't exist is public.
  // Its own child invocation, and its failure is swallowed here: posting can never
  // fail a run or block publication.
  let social: unknown;
  try {
    social = await ctx.rpc("postSocial");
  } catch (err) {
    social = { error: String(err) };
  }

  const summary = {
    sources: results.length,
    published,
    attached,
    classified: results.reduce((n, r) => n + r.classified, 0),
    deadLinks: results.reduce((n, r) => n + r.deadLinks, 0),
    dropped: results.reduce((n, r) => n + r.dropped, 0),
    social,
    perSource: results,
  };

  // Persist a per-run summary that outlives Resonate's ~24h promise GC, for feed-
  // health debugging. Keyed on this run's origin id so an at-least-once replay of
  // this step upserts the same row instead of appending a duplicate.
  await ctx.run(() => logRun(ctx.originId, summary));

  return summary;
});

// ingestSource() — durable per-source ingest. fetch (1 checkpoint) → then, per
// candidate: cheap DB dedupe (plain reads) → verify link (checkpoint) → classify
// (checkpoint, the expensive one) → persist (checkpoint). A crash resumes at the
// first step that never completed; everything before it replays from Postgres.
resonate.register("ingestSource", async function ingestSource(ctx: Context, source: SourceRow) {
  const stats: SourceStats = {
    source: source.name, fetched: 0, deadLinks: 0, classified: 0, published: 0,
    attached: 0, dropped: 0,
  };

  // Durable retry with backoff: one flaky fetch shouldn't cost a source its whole
  // hour. Each attempt is its own ctx.run checkpoint; ctx.sleep between attempts
  // suspends the run (zero compute) and is resolved by the 5s timer tick. Total
  // backoff (30s + 60s) stays far under the 5-min task lease and the 24h root
  // deadline. Only after all attempts fail do we count this source as failed.
  let entries: Candidate[] | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      entries = (await ctx.run(() => fetchFeed(source))) as Candidate[];
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await ctx.sleep(attempt * 30_000); // 30s, then 60s
    }
  }
  if (entries === null) {
    await ctx.run(() => markSourceFail(source.id));
    stats.error = String(lastErr);
    return stats;
  }
  await ctx.run(() => markSourceOk(source.id, entries.length > 0));

  // Wrapped in ctx.run so the cutoff is checkpointed: every replay uses the same
  // boundary regardless of when a resumed worker wakes (control flow must depend
  // only on checkpointed values, never on live wall-clock time).
  const now = (await ctx.run(() => Date.now())) as number;
  const cutoff = now - MAX_ITEM_AGE_DAYS * 86_400_000;
  const fresh = entries.filter((e) => Date.parse(e.publishedAt) >= cutoff);
  stats.fetched = fresh.length;

  let taken = 0;
  for (const c of fresh) {
    if (taken >= MAX_NEW_PER_SOURCE) break;

    // Cheap dedupe first — never spend a network call or a cent on the LLM for
    // something we've already seen or already rejected. These are idempotent
    // reads; on replay they simply re-run.
    const seen = (await ctx.run(() => alreadySeen(source.id, c.guid))) as boolean;
    if (seen) continue;

    // Verify the link (external fetch, checkpointed). Adopts the real permalink.
    const verdict = (await ctx.run(() => verifyLink(source, c.url))) as { ok: boolean; url: string };
    if (!verdict.ok) {
      stats.deadLinks++;
      await ctx.run(() => remember(source.id, c.guid));
      continue;
    }
    c.url = verdict.url;
    c.canonicalUrl = canonicalize(verdict.url);

    // Same URL we already hold — nothing to add, not even a citation.
    const dup = (await ctx.run(() => isDuplicateLink(c.canonicalUrl))) as boolean;
    if (dup) continue;

    // A second outlet on a story we already carry becomes a citation on the
    // existing card rather than a near-identical second card. This replaces the
    // old behaviour of silently discarding it, which threw away real information
    // (who else thought this mattered) and still left the feed looking like a
    // republisher. Attaching also skips the classify call — the story's relevance
    // and summary were settled when the first outlet's version was published.
    const candidates = (await ctx.run(() =>
      findStoryCandidates(c.title, c.snippet, c.publishedAt)
    )) as StoryCandidate[];

    let attachedTo: number | null = null;
    for (const cand of candidates) {
      const same = (await ctx.run(() => isSameStory(c, cand))) as boolean;
      if (same) {
        attachedTo = cand.id;
        break;
      }
    }
    if (attachedTo !== null) {
      await ctx.run(() => attachSource(attachedTo, source.id, c));
      // Counted on the decision, not on whether the insert reported a new row: a
      // replay re-runs attachSource, hits the conflict, and would otherwise report
      // nothing happened for an attachment that did.
      stats.attached++;
      // Adjudicating costs a model call, so an attachment spends from the same
      // per-source budget as a publish. Without this the cap guarded only the
      // publish path, and a backfill of a large source could run hundreds of
      // adjudications in one invocation while `taken` never moved.
      taken++;
      continue;
    }

    taken++;

    // Classify (the LLM call — the expensive checkpoint). Once this step is
    // recorded, no crash will ever re-invoke Claude for this article.
    let result: Classification;
    try {
      result = (await ctx.run(() => classify(source, c))) as Classification;
      stats.classified++;
    } catch (err) {
      stats.error = String(err);
      continue;
    }

    const tags = result.tags.filter((t) => TAG_SLUGS.includes(t));
    if (!result.relevant || !result.summary.trim()) {
      stats.dropped++;
      await ctx.run(() => remember(source.id, c.guid));
      continue;
    }
    await ctx.run(() => publishItem(source.id, c, result.summary.trim(), tags));
    stats.published++;
  }

  return stats;
});

// ── the social mirror (SPEC §8.4) ────────────────────────────────────────────
//
// One Bluesky account mirroring each published item exactly as the card presents
// it: headline, our own-words summary, the source credited, the link out. It is a
// mirror, not a channel — this code writes and never reads a reply, a mention, a
// DM or a timeline. The single exception is that it reads *our own repo* to find
// out whether a post it may already have sent is there; that is not a read path,
// it is the only way to make a publicly visible side effect idempotent.
const BSKY_PDS = "https://bsky.social";
// The post limit is 300 GRAPHEMES — not characters, not bytes. The external embed
// card carries the link and does not count toward it.
const BSKY_MAX_GRAPHEMES = 300;
// Eligibility window, measured on ingested_at (when *we* published, not when the
// outlet did). The migration already claims every pre-existing item as
// skipped_backfill; this window is the second lock on the same door — whatever a
// gap in that claim or a multi-day outage leaves unclaimed, the archive can never
// arrive on the timeline in a burst.
const SOCIAL_WINDOW_HOURS = 6;
// Per-run ceiling. An ordinary run publishes a handful, but the first run after a
// new source is added can publish dozens, and dozens of posts inside one minute is
// a timeline dump rather than a feed. The overflow is reported, not silently lost:
// nothing claims those items, so the next run picks them up while they're in window.
const MAX_POSTS_PER_RUN = 12;

// The post card: our own brand art with the item's headline set on it, attached as
// the link preview's thumbnail (web/src/lib/social-card.mjs renders it, served by
// /api/social-card/<id>). Two things it is NOT, and the distinction is the whole
// reason it is allowed: it is not the source's image, which §3 forbids
// republishing, and it does not displace the link card — `external.thumb` is a
// field *of* the link card, so the outlet, the description and the click-through
// all survive exactly as they are.
//
// Default OFF. Turning it on changes what a live unattended account publishes to
// the world, which is a SPEC §8.4 decision and not a deployment detail.
const SOCIAL_CARD_ENABLED = (Deno.env.get("SOCIAL_CARD") ?? "off").toLowerCase() === "on";
const SOCIAL_CARD_BASE = Deno.env.get("SOCIAL_CARD_BASE") ?? "https://pitchroots.ca";
// bsky.social rejects a blob over 1,000,000 bytes. A 1200x630 card of flat colour
// and text renders at 60-80KB, so this is a tripwire for a template that has gone
// wrong, not a limit anything is expected to approach.
const BSKY_MAX_BLOB_BYTES = 1_000_000;

type SocialItem = {
  id: number;
  source_id: number;
  source_name: string;
  title: string;
  summary: string;
  snippet: string | null;
  url: string;
  tags: string[];
};

type Citation = { name: string; url: string };
type PostRef = { uri: string; cid: string };
type BskySession = { did: string; jwt: string };

// Graphemes, because that is what the limit counts. For "👨‍👩‍👧" the three numbers
// that matter — 5 UTF-16 units, 18 bytes, 1 grapheme — are all different, and using
// the wrong one either rejects a legal post or gets a legal-looking one rejected.
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemeLen(s: string): number {
  let n = 0;
  for (const _ of GRAPHEMES.segment(s)) n++;
  return n;
}

// Facet offsets are UTF-8 BYTE offsets into the post text, not string indices. Every
// em-dash in our summaries is 3 bytes and 1 character, so a facet computed from
// indexOf lands short and silently mislinks — the post publishes, the hashtag just
// points at the wrong run of text.
const UTF8 = new TextEncoder();
function byteLen(s: string): number {
  return UTF8.encode(s).length;
}

// Split a 1–2 sentence summary at its first sentence boundary. Deliberately blunt:
// the minimum length keeps "St. John's" from reading as a whole sentence, and when
// nothing matches the caller gets the summary back unchanged, which is the safe
// answer for a summary that was one sentence all along.
function firstSentence(s: string): string {
  const m = s.match(/^.{40,}?[.!?](?=\s)/s);
  return m ? m[0] : s;
}

// The card, transposed. Priority order comes from SPEC §8.4: over budget, drop whole
// units — the hashtags, then the summary's second sentence, then the summary — never
// characters. No mid-word truncation and no ellipsis, so a headline that cannot fit
// on its own returns null and the caller parks it rather than publishing a stub.
function composePost(item: SocialItem): { text: string; facets: unknown[] } | null {
  // Ordered by the canonical vocabulary, not by however the classifier listed them:
  // leagues and national teams sit ahead of provinces in TAG_SLUGS, so "up to two"
  // keeps the two that identify the story rather than two provinces.
  const tags = TAG_SLUGS.filter((t) => item.tags.includes(t)).slice(0, 2);
  const title = item.title.trim();
  const summary = item.summary.trim();
  const via = `via ${item.source_name}`;

  const ladder = [
    { summary, tags },
    { summary, tags: [] as string[] },
    { summary: firstSentence(summary), tags: [] as string[] },
    { summary: "", tags: [] as string[] },
  ];

  for (const rung of ladder) {
    const tail = rung.tags.length
      ? `${via} ${rung.tags.map((t) => `#${t}`).join(" ")}`
      : via;
    const text = [title, rung.summary, tail].filter(Boolean).join("\n\n");
    if (graphemeLen(text) > BSKY_MAX_GRAPHEMES) continue;

    const facets = rung.tags.map((tag) => {
      // The hashtags are the last thing in the text, so search from the end — a
      // headline that happens to contain "#canpl" can't steal the offset.
      const at = text.lastIndexOf(`#${tag}`);
      const byteStart = byteLen(text.slice(0, at));
      return {
        index: { byteStart, byteEnd: byteStart + byteLen(`#${tag}`) },
        features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
      };
    });
    return { text, facets };
  }
  return null;
}

// The card's "Also covered by" line, mirrored as one self-threaded follow-up. The
// outlet name is the link: a bare URL would eat the grapheme budget and reads worse
// than the name it points at. Outlets that don't fit are dropped from the list
// rather than spilling into a second reply — one continuation of our own record,
// never a thread that grows.
function composeCitations(also: Citation[]): { text: string; facets: unknown[] } | null {
  const facets: unknown[] = [];
  let text = "Also covered by ";
  let kept = 0;
  for (const c of also) {
    const sep = kept === 0 ? "" : ", ";
    const next = `${text}${sep}${c.name}`;
    if (graphemeLen(`${next}.`) > BSKY_MAX_GRAPHEMES) break;
    const byteStart = byteLen(`${text}${sep}`);
    facets.push({
      index: { byteStart, byteEnd: byteStart + byteLen(c.name) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: c.url }],
    });
    text = next;
    kept++;
  }
  return kept === 0 ? null : { text: `${text}.`, facets };
}

// postSocial() — the mirror step. Invoked by poll() as its own child run, and by
// nothing else. Fans out over the items this run first published, oldest first, so
// the timeline reads in the same order as the feed.
resonate.register("postSocial", async function postSocial(ctx: Context) {
  // Kill switch, same posture that let the games calendar ship before its API key
  // existed: with the flag off or the credentials absent the step resolves skipped
  // and the run is otherwise completely normal.
  if ((Deno.env.get("SOCIAL_MIRROR") ?? "on").toLowerCase() === "off") {
    return { skipped: "SOCIAL_MIRROR=off" };
  }
  // Formatting can be inspected without publishing: composes every record and logs
  // it, touching neither the API nor social_posts. Hand-posting to check a format is
  // banned by §2, and the first post on that timeline should be the pipeline's.
  const dryRun = Deno.env.get("SOCIAL_MIRROR_DRY_RUN") === "1";

  const queue = (await ctx.run(() => getSocialQueue())) as SocialItem[];
  if (queue.length === 0) return { eligible: 0, posted: 0 };

  const eligible = queue.slice(0, MAX_POSTS_PER_RUN);
  const deferred = queue.length - eligible.length;

  // One session per run, reused across every post. createSession is rate-limited far
  // more tightly than posting is, so a session per post would throttle long before
  // the posts did. Deliberately NOT a ctx.run checkpoint, for two reasons that both
  // rule it out on their own: the access token is a credential and a checkpoint
  // would journal it into Postgres, and it expires in about two hours while a
  // durable run can resume a day later — a replayed checkpoint would hand every post
  // a dead token. Re-authenticating on replay is correct and costs one call.
  let session: BskySession | null = null;
  if (!dryRun) {
    try {
      session = await bskyLogin();
    } catch (err) {
      // Nothing has been claimed yet, so no row is burned by an auth outage; the
      // next run tries again with the same queue.
      return { skipped: `bluesky auth failed: ${String(err)}`, eligible: eligible.length };
    }
    if (session === null) return { skipped: "no Bluesky credentials", eligible: eligible.length };
  }

  // A checkpointed run clock: every post's createdAt derives from it, so a replay
  // stamps the same values. The per-item offset keeps the timeline's own ordering
  // unambiguous — posting oldest-first is the whole point, and identical timestamps
  // would leave the order up to the client.
  const now = (await ctx.run(() => Date.now())) as number;

  let posted = 0, adopted = 0, failed = 0, threaded = 0;

  for (let i = 0; i < eligible.length; i++) {
    const item = eligible[i];
    const composed = composePost(item);
    const citations = (await ctx.run(() => getCitations(item.id, item.source_id))) as Citation[];
    const thread = composeCitations(citations);

    const record = composed && {
      $type: "app.bsky.feed.post",
      text: composed.text,
      facets: composed.facets,
      langs: ["en"],
      createdAt: new Date(now + i * 1000).toISOString(),
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: item.url,
          title: item.title,
          // The source's own description, as any link preview shows it. Capped
          // because clients truncate anyway. Never the source's OWN image: §3
          // forbids republishing those, and a thumb blob would be exactly that —
          // which is why the card below is drawn by us rather than fetched.
          description: embedDescription(item),
        },
      },
    };

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: item.id, record, thread }));
      continue;
    }

    if (record === null) {
      // 300 graphemes of headline with nowhere left to cut. Parking it is the honest
      // outcome: §8.4 forbids mid-word truncation, and the audit will surface it.
      await ctx.run(() => recordSocialFailure(item.id, "headline alone exceeds 300 graphemes", true));
      failed++;
      continue;
    }

    // Claim before the call, never after. `getSocialQueue` already excluded anything
    // with a row, so a conflict here means a concurrent or replayed execution got
    // there first and its verdict wins.
    const claim = (await ctx.run(() => claimSocialPost(item.id))) as string;
    if (claim !== "claimed" && claim !== "pending") continue;

    let ref: (PostRef & { existed: boolean }) | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // The card is attached on the FIRST attempt only. If attempt 1 failed,
        // the thumb is a prime suspect — a blob the PDS accepted at uploadBlob
        // and then rejected at createRecord fails identically every time, so
        // three attempts carrying the same picture would exhaust the retries and
        // park an item that would post perfectly well without it. Dropping the
        // picture on the way to the retry is what makes "degrade, never fail"
        // true here rather than merely intended.
        const withCard = attempt === 1;
        ref = (await ctx.run(() =>
          reconcileOrPost(
            session!,
            item.url,
            record,
            withCard ? () => uploadCardThumb(session!, item.id) : undefined,
          )
        )) as PostRef & { existed: boolean };
        break;
      } catch (err) {
        // Two durable retries, then park. ctx.sleep suspends the run at zero compute
        // and is resolved by the timer tick, the same shape as the feed-fetch retry.
        await ctx.run(() => recordSocialFailure(item.id, String(err), attempt === 3));
        if (attempt < 3) await ctx.sleep(attempt * 30_000);
      }
    }
    if (ref === null) {
      failed++;
      continue;
    }

    if (ref.existed) adopted++;
    else posted++;
    await ctx.run(() => markSocialPosted(item.id, ref!.uri, ref!.cid));

    if (thread !== null) {
      try {
        const made = (await ctx.run(() =>
          reconcileOrThread(session!, ref!, thread, new Date(now + i * 1000 + 500).toISOString())
        )) as boolean;
        if (made) threaded++;
      } catch {
        // A missing citation reply is a cosmetic loss on a post that is already
        // correct and already credits its own source. It is not worth a retry, and
        // certainly not worth failing a row that is genuinely posted.
      }
    }
  }

  return {
    eligible: eligible.length,
    posted,
    adopted,
    failed,
    threaded,
    deferred,
    dryRun: dryRun || undefined,
  };
});

// recheckDisabledSources() — the auto-heal half of the self-healing pair. A source
// that fails enough whole polls in a row gets parked (active=false) by markSourceFail;
// this durable run — invoked by its own daily pg_cron job — re-fetches each parked
// feed in a checkpoint and un-parks the ones that respond, resetting fail_count.
// Calendar-scale scheduling lives in pg_cron rather than a multi-day ctx.sleep,
// which sidesteps the 24h root-timeout clamp.
resonate.register(
  "recheckDisabledSources",
  async function recheckDisabledSources(ctx: Context) {
    const disabled = (await ctx.run(() => getDisabledSources())) as SourceRow[];
    let healed = 0;
    for (const source of disabled) {
      try {
        // Reachable, parseable, AND actually carrying items — a feed parked for
        // serving empty 200s would otherwise be revived on the very next recheck,
        // since fetching it succeeds every time.
        const entries = (await ctx.run(() => fetchFeed(source))) as Candidate[];
        if (entries.length === 0) continue;
        await ctx.run(() => reviveSource(source.id));
        healed++;
      } catch {
        // still down — leave it parked for the next daily recheck
      }
    }
    return { checked: disabled.length, healed };
  },
);

// audit() — the daily external-state re-verifier, invoked by its own pg_cron job.
// Every check that guards the pipeline runs once, at publish time — but links die
// afterwards, feeds go quiet while still answering 200, and publishers file other
// sports into their soccer category. None of those announce themselves. This job
// re-checks a slice of that external state every day and writes findings to
// audit_findings; re-running it never duplicates an unresolved finding. It only
// ever REPORTS — each check has a known benign false positive (a transient fetch
// error looks like a dead link; a soccer story can live under /hockey/ when its
// subject is a hockey figure; a provincial feed can be legitimately quiet), so
// deletion is a human decision.
const AUDIT_LINK_SLICE = 30; // ~daily slice; the corpus turns over about weekly
const AUDIT_QUIET_DAYS = 7;
const AUDIT_EMPTY_STREAK = 3;

resonate.register("audit", async function audit(ctx: Context) {
  // Dead links: re-verify a rolling slice of items, oldest-checked first. Each
  // fetch and each write is its own checkpoint, so a crash mid-slice resumes
  // where it left off without re-fetching.
  const slice = (await ctx.run(() => getLinkAuditSlice())) as
    { id: number; url: string; source: SourceRow }[];
  let dead = 0;
  for (const row of slice) {
    const verdict = (await ctx.run(() => verifyLink(row.source, row.url))) as
      { ok: boolean; url: string };
    if (!verdict.ok) dead++;
    await ctx.run(() => recordLinkCheck(row.id, row.url, verdict.ok));
  }

  const quiet = (await ctx.run(() => flagQuietSources())) as number;
  const empty = (await ctx.run(() => flagEmptyFeeds())) as number;
  const offTopic = (await ctx.run(() => flagOffTopicItems())) as number;
  const social = (await ctx.run(() => flagStuckSocialPosts())) as number;

  return { linksChecked: slice.length, dead, quiet, empty, offTopic, social };
});

// pollGames() — the daily games-calendar sync, invoked by its own pg_cron job.
// Fetches every upcoming soccer event in Canada from the Ticketmaster Discovery
// API (one integration covers the Canadian MLS clubs, most CPL and NSL home
// dates, and national-team games — and the ticket link is the payload, not
// something to hunt for), maps each event to a competition in plain code, and
// upserts. Fixtures move — reschedules, cancellations, new onsales — so the
// upsert overwrites in place rather than insert-only; replaying a completed
// step rewrites identical values, which keeps it safe under at-least-once
// side effects. No LLM in this path: the provider data is structured and the
// club map is deterministic, so a sync run costs nothing but HTTP.
const TM_PAGE_SIZE = 200; // provider max; all upcoming CA soccer fits in 1-2 pages
const TM_MAX_PAGES = 5; // deep-paging cap is size*page < 1000 anyway

// Club → competition, matched against attraction names and the event title.
// Slugs deliberately reuse the news tag vocabulary. An unmatched event is kept
// as 'other' (stored, never rendered) so widening coverage later is a mapping
// change, not a re-fetch. Ordered: exclusions must run before club patterns
// because reserve sides share their parent club's name.
const GAME_EXCLUDE = /parking|tailgate|suite|vip package|season|flex pack|membership|camp\b|viewing party/i;
const RESERVE_SIDE = /\bII\b|\bFC 2\b|academy/i;
const TEAM_COMPETITION: [RegExp, string][] = [
  [/toronto fc/i, "mls"],
  [/whitecaps/i, "mls"],
  [/cf montr[eé]al/i, "mls"],
  [/atl[eé]tico ottawa/i, "canpl"],
  [/cavalry/i, "canpl"],
  [/forge/i, "canpl"],
  [/halifax wanderers|hfx wanderers/i, "canpl"],
  [/pacific fc/i, "canpl"],
  [/valour/i, "canpl"],
  [/vancouver fc/i, "canpl"],
  [/york united/i, "canpl"],
  [/afc toronto/i, "nsl"],
  [/calgary wild/i, "nsl"],
  [/halifax tides/i, "nsl"],
  [/montreal roses|roses de montr[eé]al/i, "nsl"],
  [/ottawa rapid/i, "nsl"],
  [/vancouver rise/i, "nsl"],
  // The box office names national-team games "Canada WNT v Denmark" / "Canada
  // MNT v Chile" — the spelled-out patterns are kept as a fallback. WNT must
  // stay ahead of MNT: "women" contains "men", so order is what disambiguates.
  [/canada wnt|canwnt|canad(a|ian).*women.*national/i, "canwnt"],
  [/canada mnt|canmnt|canad(a|ian).*men.*national/i, "canmnt"],
];

// Slim, JSON-serializable shape — the raw provider event is far too large to
// checkpoint 200 at a time.
type GameRow = {
  providerEventId: string;
  competition: string;
  name: string;
  homeTeam: string | null;
  awayTeam: string | null;
  kickoffAt: string | null; // ISO
  timezone: string | null;
  venue: string | null;
  city: string | null;
  province: string | null;
  ticketUrl: string;
  status: string;
};

function mapCompetition(names: string[]): string {
  for (const n of names) {
    if (RESERVE_SIDE.test(n)) return "other";
  }
  for (const n of names) {
    for (const [re, slug] of TEAM_COMPETITION) {
      if (re.test(n)) return slug;
    }
  }
  return "other";
}

// deno-lint-ignore no-explicit-any
function mapEvent(ev: any): GameRow | null {
  const name: string = ev?.name ?? "";
  const url: string = ev?.url ?? "";
  if (!ev?.id || !name || !url) return null;
  if (GAME_EXCLUDE.test(name)) return null;
  const attractions: string[] = (ev?._embedded?.attractions ?? [])
    .map((a: { name?: string }) => a?.name ?? "")
    .filter(Boolean);
  // Provider convention: attractions[0] is the home side. Fall back to splitting
  // the event title, whose "Home vs. Away" ordering follows the same convention.
  // Separators observed in real listings: "vs.", "vs", "v.", and bare "v"
  // ("Canada MNT v Chile") — the whitespace on both sides keeps a bare v from
  // matching inside a word.
  const vsSplit = name.split(/\s+(?:vs\.?|v\.?)\s+/i);
  const fromTitle = vsSplit.length === 2;
  // "Canadian Soccer Association" is the box office's attraction name for both
  // national teams. Once it's in the list the index convention is useless for
  // naming (and filtering it out would slide the opponent into the home slot),
  // so a national-team listing takes both sides from the title — which carries
  // the names a fan recognises ("Canada WNT v Denmark"). The competition map
  // below still sees every attraction name, so classification is unaffected.
  const nationalTeam = attractions.some((n) => /canadian soccer association/i.test(n));
  const homeTeam = nationalTeam && fromTitle
    ? vsSplit[0].trim()
    : attractions[0] ?? (fromTitle ? vsSplit[0].trim() : null);
  const awayTeam = nationalTeam && fromTitle
    ? vsSplit[1].trim()
    : attractions[1] ?? (fromTitle ? vsSplit[1].trim() : null);
  const venue = ev?._embedded?.venues?.[0];
  // A "Canadian Championship:" title prefix beats the club map — a CPL club
  // hosting a League1 side in the cup is a cup game, not a league fixture, and
  // the slug already exists as a news tag so the pill links to the right hub.
  const competition = /canadian championship/i.test(name)
    ? "canadian-championship"
    : mapCompetition([...attractions, name]);
  return {
    providerEventId: String(ev.id),
    competition,
    name,
    homeTeam,
    awayTeam,
    kickoffAt: ev?.dates?.start?.dateTime ?? null,
    timezone: ev?.dates?.timezone ?? null,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    province: venue?.state?.stateCode ?? null,
    ticketUrl: url,
    status: ev?.dates?.status?.code ?? "onsale",
  };
}

resonate.register("pollGames", async function pollGames(ctx: Context) {
  // Deploy-before-key guard: without the secret the run reports itself skipped
  // rather than failing — the schedule can be armed before the key exists.
  if (!Deno.env.get("TICKETMASTER_API_KEY")) {
    return { skipped: "TICKETMASTER_API_KEY not set" };
  }

  // Checkpointed clock, same rule as ingestSource: every replay must query the
  // same window.
  const now = (await ctx.run(() => Date.now())) as number;

  const rows: GameRow[] = [];
  let totalPages = 1;
  for (let page = 0; page < totalPages && page < TM_MAX_PAGES; page++) {
    const res = (await ctx.run(() => fetchGamesPage(now, page))) as {
      totalPages: number;
      rows: GameRow[];
    };
    totalPages = res.totalPages;
    rows.push(...res.rows);
  }

  const upserted = (await ctx.run(() => upsertGames(rows))) as number;
  // New games or moved kickoffs should show without waiting for the ISR timer.
  if (rows.length > 0) await ctx.run(() => triggerRevalidate());

  const byCompetition: Record<string, number> = {};
  for (const r of rows) byCompetition[r.competition] = (byCompetition[r.competition] ?? 0) + 1;
  const summary = { fetched: rows.length, mapped: rows.filter((r) => r.competition !== "other").length, upserted, byCompetition };
  await ctx.run(() => logGamesRun(ctx.originId, summary));
  return summary;
});

resonate.httpHandler();

// ── data access (plain SQL; each is called inside a ctx.run) ─────────────────

async function getActiveSources(): Promise<SourceRow[]> {
  return await sql<SourceRow[]>`select * from sources where active order by id`;
}

// A feed that answers 200 with an empty channel is the blind spot that let the old
// Canada Soccer feed sit dead from launch: fetchFeed succeeds, so fail_count resets
// and auto-park never fires. Track consecutive empty parses separately and park on
// the same threshold. The test is on RAW entries, not post-cutoff `fresh` — a
// low-volume source with nothing published this week is healthy, not broken.
async function markSourceOk(id: number, hadEntries: boolean): Promise<null> {
  await sql`
    update sources
       set last_polled_at = now(),
           last_ok_at = now(),
           fail_count = 0,
           empty_streak = case when ${hadEntries} then 0 else empty_streak + 1 end,
           active = case
             when not ${hadEntries} and empty_streak + 1 >= ${FAIL_DISABLE_THRESHOLD}
             then false else active end
     where id = ${id}`;
  return null;
}

async function markSourceFail(id: number): Promise<null> {
  // Non-idempotent increment by design — a best-effort health counter (see the
  // semantics note at the top of the file); an over-count on replay is harmless.
  // Auto-disable: each poll already exhausts its own fetch retries before landing
  // here, so once a source has failed FAIL_DISABLE_THRESHOLD whole polls in a row
  // (~a day of hourly failures) we park it — the hourly run only reads active
  // sources, so it drops out. recheckDisabledSources un-parks it when it recovers.
  await sql`
    update sources
       set last_polled_at = now(),
           fail_count = fail_count + 1,
           active = case when fail_count + 1 >= ${FAIL_DISABLE_THRESHOLD} then false else active end
     where id = ${id}`;
  return null;
}

async function getDisabledSources(): Promise<SourceRow[]> {
  // `retired` distinguishes "we decided to stop carrying this" from "it is failing
  // health checks". Without it, auto-heal would cheerfully un-park a source that was
  // dropped on purpose, because a retired feed usually still responds fine.
  return await sql<SourceRow[]>`select * from sources where not active and not retired order by id`;
}

async function reviveSource(id: number): Promise<null> {
  await sql`update sources set active = true, fail_count = 0, empty_streak = 0, last_ok_at = now(), last_polled_at = now() where id = ${id}`;
  return null;
}

async function logRun(
  originId: string,
  s: {
    sources: number;
    published: number;
    attached: number;
    classified: number;
    deadLinks: number;
    dropped: number;
    perSource: SourceStats[];
  },
): Promise<null> {
  await sql`
    insert into run_log (origin_id, sources, published, attached, classified, dead_links, dropped, per_source)
    values (${originId}, ${s.sources}, ${s.published}, ${s.attached}, ${s.classified},
            ${s.deadLinks}, ${s.dropped}, ${sql.json(s.perSource)})
    on conflict (origin_id) do nothing`;
  return null;
}

async function alreadySeen(sourceId: number, guid: string): Promise<boolean> {
  const [byGuid] = await sql`select 1 from items where source_id = ${sourceId} and guid = ${guid} limit 1`;
  if (byGuid) return true;
  // An attached outlet is remembered on the citation rather than in `rejections`.
  // `rejections` has no foreign key to `items`, so a guid recorded there outlives
  // the item it referred to — deleting a story would leave every outlet that had
  // been attached to it permanently unable to be ingested again, because nothing
  // would ever re-offer that guid. Citations cascade with the item, so this memo
  // dies exactly when the thing it describes does.
  const [cited] = await sql`
    select 1 from item_sources where source_id = ${sourceId} and guid = ${guid} limit 1`;
  if (cited) return true;
  const [rejected] = await sql`select 1 from rejections where source_id = ${sourceId} and guid = ${guid} limit 1`;
  return Boolean(rejected);
}

// The only hard drop is the exact same link — there is genuinely nothing to add,
// not even a citation. Everything else, however similar the headline, goes to the
// clustering path to be judged.
//
// This used to also drop on title similarity > 0.65, which quietly defeated the
// whole point of clustering: the most headline-identical cross-outlet pairs — the
// ones most likely to be the same story — were discarded here before the citation
// path ever saw them, leaving only the weaker 0.45–0.65 band able to produce a
// citation. Exactly backwards. Worse, this path never memoized what it dropped, so
// every dropped item was re-evaluated on every run until it aged out a week later.
async function isDuplicateLink(canonicalUrl: string): Promise<boolean> {
  const [byUrl] = await sql`select 1 from items where canonical_url = ${canonicalUrl} limit 1`;
  return Boolean(byUrl);
}

async function remember(sourceId: number, guid: string): Promise<null> {
  await sql`insert into rejections (source_id, guid) values (${sourceId}, ${guid}) on conflict do nothing`;
  return null;
}

type StoryCandidate = { id: number; title: string; summary: string };

// Pre-filter for the adjudicator, matched on headline PLUS the article's opening
// text. Headlines alone were the wrong signal: outlets word them deliberately
// differently, so real same-event pairs measured 0.14–0.43 while *distinct* stories
// sharing a template measured up to 0.87 — the bands overlapped so completely that
// no threshold separated them, and at the old 0.45 not one known duplicate was even
// considered. Including body text moved every measured same-story pair up and most
// distinct pairs down, because a shared headline template gets diluted by the parts
// that actually differ. Both sides are truncated to keep the comparison balanced —
// trigram similarity falls off when one side is much longer than the other.
const MATCH_CHARS = 300;
const STORY_MATCH_THRESHOLD = 0.30;

async function findStoryCandidates(
  title: string,
  snippet: string,
  publishedAt: string,
): Promise<StoryCandidate[]> {
  const probe = `${title} ${snippet}`.slice(0, MATCH_CHARS);
  return await sql<StoryCandidate[]>`
    select id, title, summary from items
    where published_at between ${publishedAt}::timestamptz - interval '3 days'
                           and ${publishedAt}::timestamptz + interval '3 days'
      and similarity(
            left(lower(title || ' ' || coalesce(snippet, summary)), ${MATCH_CHARS}),
            lower(${probe})
          ) > ${STORY_MATCH_THRESHOLD}
    order by similarity(
            left(lower(title || ' ' || coalesce(snippet, summary)), ${MATCH_CHARS}),
            lower(${probe})
          ) desc
    limit 3`;
}

// Attach an outlet to an existing story. Returns false when this source is already
// cited on it, so an at-least-once replay counts the attachment exactly once.
async function attachSource(itemId: number, sourceId: number, c: Candidate): Promise<boolean> {
  const rows = await sql`
    insert into item_sources (item_id, source_id, guid, url, title, published_at)
    values (${itemId}, ${sourceId}, ${c.guid}, ${c.url}, ${c.title}, ${c.publishedAt})
    on conflict (item_id, source_id) do nothing
    returning item_id`;
  return rows.length > 0;
}

async function publishItem(
  sourceId: number,
  c: Candidate,
  summary: string,
  tags: string[],
): Promise<null> {
  // The item and its first citation land together. The `target` CTE resolves the
  // row id whether this call inserted it or a replay found it already there, so an
  // at-least-once retry still records exactly one citation.
  await sql`
    with ins as (
      insert into items (source_id, guid, url, canonical_url, title, summary, snippet, tags, published_at)
      values (${sourceId}, ${c.guid}, ${c.url}, ${c.canonicalUrl}, ${c.title},
              ${summary}, ${c.snippet}, ${tags}, ${c.publishedAt})
      on conflict (canonical_url) do nothing
      returning id
    ), target as (
      select id from ins
      union all
      select id from items
       where canonical_url = ${c.canonicalUrl} and not exists (select 1 from ins)
    )
    insert into item_sources (item_id, source_id, guid, url, title, published_at)
    select id, ${sourceId}, ${c.guid}, ${c.url}, ${c.title}, ${c.publishedAt}::timestamptz from target
    on conflict (item_id, source_id) do nothing`;
  return null;
}

// After a run publishes new items, ask the Vercel site to revalidate its static
// pages so the new items show up without waiting for the ISR timer. Bearer-
// protected; a lost ping just means the pages refresh on their normal 15-min
// timer instead of immediately.
// The link-audit rotation: items least-recently verified come first, never-verified
// before all of them. The source row rides along because verifyLink needs the
// source's UA and rewrite rule (re-applying a rewrite to an already-rewritten URL
// is a no-op — the from-pattern no longer matches).
async function getLinkAuditSlice(): Promise<{ id: number; url: string; source: SourceRow }[]> {
  return await sql<{ id: number; url: string; source: SourceRow }[]>`
    select i.id, i.url, row_to_json(s.*) as source
    from items i join sources s on s.id = i.source_id
    order by i.last_verified_at asc nulls first, i.id asc
    limit ${AUDIT_LINK_SLICE}`;
}

// Stamp the check regardless of outcome (that is what drives the rotation), and
// record a finding only for hard-dead links — verifyLink already gives transient
// failures the benefit of the doubt. Never flag the same unresolved link twice.
async function recordLinkCheck(itemId: number, url: string, ok: boolean): Promise<null> {
  await sql`update items set last_verified_at = now() where id = ${itemId}`;
  if (!ok) {
    await sql`
      insert into audit_findings (kind, subject_id, detail)
      select 'dead_link', ${itemId}, ${url}
      where not exists (
        select 1 from audit_findings
        where kind = 'dead_link' and subject_id = ${itemId} and resolved_at is null)`;
  }
  return null;
}

// Active sources with no published or attached item in AUDIT_QUIET_DAYS. A signal,
// not an error — provincial associations are legitimately low-volume — so after a
// finding is resolved the source gets a week of grace before it can be re-flagged,
// rather than nagging daily about a condition someone already looked at.
async function flagQuietSources(): Promise<number> {
  const rows = await sql`
    insert into audit_findings (kind, subject_id, detail)
    select 'quiet_source', s.id,
           s.name || ': no items in ' || ${AUDIT_QUIET_DAYS} || ' days (may be legitimately low-volume)'
    from sources s
    where s.active and not s.retired
      and not exists (
        select 1 from item_sources x
        where x.source_id = s.id
          and x.published_at >= now() - make_interval(days => ${AUDIT_QUIET_DAYS}))
      and not exists (
        select 1 from audit_findings f
        where f.kind = 'quiet_source' and f.subject_id = s.id
          and (f.resolved_at is null or f.resolved_at > now() - make_interval(days => ${AUDIT_QUIET_DAYS})))
    returning id`;
  return rows.length;
}

// Sources answering 200 with an empty channel for several consecutive polls.
// empty_streak already exists and parks the source at the same threshold as hard
// failures; this surfaces the ones drifting toward it. Same post-resolution grace
// as quiet_source.
async function flagEmptyFeeds(): Promise<number> {
  const rows = await sql`
    insert into audit_findings (kind, subject_id, detail)
    select 'empty_feed', s.id, s.name || ': empty_streak = ' || s.empty_streak
    from sources s
    where s.active and s.empty_streak > ${AUDIT_EMPTY_STREAK}
      and not exists (
        select 1 from audit_findings f
        where f.kind = 'empty_feed' and f.subject_id = s.id
          and (f.resolved_at is null or f.resolved_at > now() - make_interval(days => ${AUDIT_QUIET_DAYS})))
    returning id`;
  return rows.length;
}

// Items whose canonical URL path names another sport. This exact heuristic found
// two live leaks that a title-keyword sweep missed — but a genuine soccer story CAN
// be filed under another sport's section (a Whitecaps ownership story lived under
// /hockey/nhl/ because the buyer was a former Canucks owner), which is why this
// reports for review and never deletes. The URL of a given item never changes, so
// once a finding exists for an item — resolved or not — it is never re-raised.
async function flagOffTopicItems(): Promise<number> {
  const rows = await sql`
    insert into audit_findings (kind, subject_id, detail)
    select 'off_topic', i.id, i.canonical_url
    from items i
    where i.canonical_url ~* '/(hockey|golf|cfl|nfl|basketball|baseball|curling)/'
      and not exists (
        select 1 from audit_findings f
        where f.kind = 'off_topic' and f.subject_id = i.id)
    returning id`;
  return rows.length;
}

// One Discovery API page of upcoming soccer-in-Canada events, already mapped to
// the slim GameRow shape (the raw payload is too large to checkpoint). The
// startDateTime derives from the checkpointed run clock, so a replay requests
// the same window. Ticketmaster rejects fractional seconds in datetimes.
async function fetchGamesPage(
  now: number,
  page: number,
): Promise<{ totalPages: number; rows: GameRow[] }> {
  const start = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    apikey: Deno.env.get("TICKETMASTER_API_KEY")!,
    classificationName: "Soccer",
    countryCode: "CA",
    startDateTime: start,
    sort: "date,asc",
    size: String(TM_PAGE_SIZE),
    page: String(page),
  });
  const res = await fetch(
    `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`);
  const doc = await res.json();
  const events: unknown[] = doc?._embedded?.events ?? [];
  return {
    totalPages: doc?.page?.totalPages ?? 1,
    rows: events.map(mapEvent).filter((r): r is GameRow => r !== null),
  };
}

// Upsert the day's snapshot. Insert-or-overwrite on the provider event id:
// fixtures reschedule, venues change, sale status flips — the latest snapshot
// wins, and a replayed step rewrites identical values.
async function upsertGames(rows: GameRow[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const res = await sql`
      insert into games (provider, provider_event_id, competition, name, home_team, away_team,
                         kickoff_at, timezone, venue, city, province, ticket_url, status, last_seen_at)
      values ('ticketmaster', ${r.providerEventId}, ${r.competition}, ${r.name}, ${r.homeTeam},
              ${r.awayTeam}, ${r.kickoffAt}, ${r.timezone}, ${r.venue}, ${r.city}, ${r.province},
              ${r.ticketUrl}, ${r.status}, now())
      on conflict (provider, provider_event_id) do update set
        competition = excluded.competition,
        name = excluded.name,
        home_team = excluded.home_team,
        away_team = excluded.away_team,
        kickoff_at = excluded.kickoff_at,
        timezone = excluded.timezone,
        venue = excluded.venue,
        city = excluded.city,
        province = excluded.province,
        ticket_url = excluded.ticket_url,
        status = excluded.status,
        last_seen_at = now()
      returning id`;
    n += res.length;
  }
  return n;
}

async function logGamesRun(
  originId: string,
  s: { fetched: number; mapped: number; upserted: number; byCompetition: Record<string, number> },
): Promise<null> {
  await sql`
    insert into games_run_log (origin_id, fetched, mapped, upserted, by_competition)
    values (${originId}, ${s.fetched}, ${s.mapped}, ${s.upserted}, ${sql.json(s.byCompetition)})
    on conflict (origin_id) do nothing`;
  return null;
}

// A mirror row that never settled. `failed` means the retry budget was spent and
// nothing will pick it up again; `pending` past the window means an execution
// claimed a post and never came back to say what happened, which is the one state
// where a post might exist that nothing in the database knows about. Both are
// reports, not repairs — re-posting on a hunch is how a timeline gets a duplicate.
const AUDIT_SOCIAL_STUCK_HOURS = 2;

async function flagStuckSocialPosts(): Promise<number> {
  const rows = await sql`
    insert into audit_findings (kind, subject_id, detail)
    select 'social_stuck', p.item_id,
           p.status || ' after ' || p.attempts || ' attempt(s): ' ||
           coalesce(p.last_error, 'no error recorded')
    from social_posts p
    where (p.status = 'failed'
           or (p.status = 'pending'
               and p.created_at < now() - ${`${AUDIT_SOCIAL_STUCK_HOURS} hours`}::interval))
      and not exists (
        select 1 from audit_findings f
        where f.kind = 'social_stuck' and f.subject_id = p.item_id and f.resolved_at is null)
    returning id`;
  return rows.length;
}

// ── the social mirror: Bluesky calls and their DB side ───────────────────────

// An app password, never the account password — revocable from the account without
// touching anything else. Returns null (rather than throwing) when the credentials
// simply aren't set, which is the kill switch, not a failure.
async function bskyLogin(): Promise<BskySession | null> {
  const identifier = Deno.env.get("BLUESKY_HANDLE");
  const password = Deno.env.get("BLUESKY_APP_PASSWORD");
  if (!identifier || !password) return null;
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`createSession HTTP ${res.status}: ${body?.message ?? ""}`);
  return { did: body.did, jwt: body.accessJwt };
}

// The one read this account performs, and it reads only its own repo: has the post
// we are about to send already been sent? Matching is on the embed's link, which is
// unique per item and is the field we control.
async function bskyFindPost(
  session: BskySession,
  match: (value: Record<string, any>) => boolean,
): Promise<PostRef | null> {
  const params = new URLSearchParams({
    repo: session.did,
    collection: "app.bsky.feed.post",
    limit: "100",
  });
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.listRecords?${params}`, {
    headers: { authorization: `Bearer ${session.jwt}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`listRecords HTTP ${res.status}: ${body?.message ?? ""}`);
  for (const rec of body?.records ?? []) {
    if (match(rec?.value ?? {})) return { uri: rec.uri, cid: rec.cid };
  }
  return null;
}

async function bskyCreatePost(session: BskySession, record: unknown): Promise<PostRef> {
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `createRecord HTTP ${res.status}: ${body?.error ?? ""} ${body?.message ?? ""}`.trim(),
    );
  }
  return { uri: body.uri, cid: body.cid };
}

// Look, then write — inside ONE checkpoint, which is the entire point of the shape.
// The gap at-least-once leaves open is a side effect that completed and a journal
// write that didn't; a replay re-executes this step, so the look re-executes with it
// and finds the post the lost execution made instead of sending a second one. A
// reconcile that lived in its own checkpoint would be replayed from the journal —
// stale, and worthless exactly when it is needed.
//
// The card blob is minted HERE, inside the same checkpoint, for the same reason:
// a blob that no record references is garbage-collected by the PDS, so a blob ref
// journalled in an earlier checkpoint and replayed a day later can point at
// nothing. Uploaded beside the createRecord that references it, it cannot rot.
async function reconcileOrPost(
  session: BskySession,
  linkUri: string,
  record: unknown,
  loadThumb?: () => Promise<unknown | null>,
): Promise<PostRef & { existed: boolean }> {
  const existing = await bskyFindPost(session, (v) => v?.embed?.external?.uri === linkUri);
  if (existing) return { ...existing, existed: true };

  let toSend = record;
  if (loadThumb) {
    const thumb = await loadThumb();
    // Absent thumb is not an error. The mirror's job is the headline and the link
    // out; the card is presentation. A render blip, a cold Vercel function or an
    // oversized PNG must cost us the picture, never the post — the alternative is
    // an item parked for a day over an image nobody has missed yet.
    if (thumb) {
      const r = record as { embed: { external: Record<string, unknown> } };
      toSend = { ...r, embed: { ...r.embed, external: { ...r.embed.external, thumb } } };
    }
  }
  return { ...(await bskyCreatePost(session, toSend)), existed: false };
}

// Fetch this item's card from the site and hand it to the PDS as a blob. Every
// failure path returns null — see the note above about presentation vs. the post.
async function uploadCardThumb(session: BskySession, itemId: number): Promise<unknown | null> {
  if (!SOCIAL_CARD_ENABLED) return null;
  try {
    // 8s, not 25s. The card is a cached static render; if it has not answered by
    // now it is not going to, and the budget matters — this runs up to 12 times
    // in one execution, and a long tail here pushes the whole run toward a
    // wall-clock kill, which strands rows as `pending` instead of failing them.
    const res = await fetch(`${SOCIAL_CARD_BASE}/api/social-card/${itemId}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`social card ${itemId}: HTTP ${res.status}`);
      // Drain, or the connection is held until GC across a run where the card
      // endpoint is down — which is exactly the run that makes 12 of these.
      await res.body?.cancel();
      return null;
    }

    // Refuse an oversized body BEFORE buffering it. The size check used to run
    // after arrayBuffer(), which meant a misconfigured base URL returning
    // something huge would be fully materialised first; an isolate killed on
    // memory is not a JS exception, so it escapes this try/catch AND the retry
    // loop, leaving the row claimed with no verdict.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > BSKY_MAX_BLOB_BYTES) {
      console.warn(`social card ${itemId}: content-length ${declared}, not uploading`);
      await res.body?.cancel();
      return null;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > BSKY_MAX_BLOB_BYTES) {
      console.warn(`social card ${itemId}: ${bytes.byteLength} bytes, not uploading`);
      return null;
    }
    // Is it actually a PNG? A 200 is not proof: the renderer commits its status
    // before it draws, so a failed render can arrive as a truncated 200 that
    // every check above waves through. Without this, the account publishes a
    // post whose preview image is broken — the one defect nobody is watching
    // for, on the one path nobody is watching.
    if (!isPng(bytes)) {
      console.warn(`social card ${itemId}: body is not a PNG, not uploading`);
      return null;
    }
    return await bskyUploadBlob(session, bytes, "image/png");
  } catch (err) {
    console.warn(`social card ${itemId}: ${String(err)}`);
    return null;
  }
}

// The 8-byte PNG signature, plus a check that the file ends in an IEND chunk —
// together they catch both "this is not a PNG at all" and "this is a PNG that
// stopped halfway", which is the shape a failed render actually takes.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return false;
  const tail = bytes.byteLength - PNG_IEND.length;
  return PNG_IEND.every((b, i) => bytes[tail + i] === b);
}

// uploadBlob takes raw bytes with the image's own content-type — not multipart,
// not base64, not JSON. It returns a blob ref that is only durable once a record
// references it.
async function bskyUploadBlob(
  session: BskySession,
  bytes: Uint8Array,
  mime: string,
): Promise<unknown> {
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.jwt}`, "content-type": mime },
    body: bytes,
    // 10s for an ~70KB upload. Same reasoning as the fetch above: this runs once
    // per item, up to 12 per execution, and the run has a wall clock.
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`uploadBlob HTTP ${res.status}: ${body?.message ?? ""}`);
  return body.blob;
}

// Same shape for the citation reply, matched on its parent instead of its link. A
// self-thread needs BOTH root and parent, and here they are the same post: this is a
// continuation of our own record, never a reply to a person.
async function reconcileOrThread(
  session: BskySession,
  parent: PostRef,
  thread: { text: string; facets: unknown[] },
  createdAt: string,
): Promise<boolean> {
  const existing = await bskyFindPost(session, (v) => v?.reply?.parent?.uri === parent.uri);
  if (existing) return false;
  await bskyCreatePost(session, {
    $type: "app.bsky.feed.post",
    text: thread.text,
    facets: thread.facets,
    langs: ["en"],
    createdAt,
    reply: { root: parent, parent },
  });
  return true;
}

// The link-preview description. The source's own words from its own feed, which is
// exactly what a preview card shows anywhere else; capped because every client
// truncates it, and falling back to the outlet's name rather than to nothing.
const EMBED_DESCRIPTION_CHARS = 280;
function embedDescription(item: SocialItem): string {
  const s = (item.snippet ?? "").trim();
  if (!s) return item.source_name;
  if (s.length <= EMBED_DESCRIPTION_CHARS) return s;
  const cut = s.slice(0, EMBED_DESCRIPTION_CHARS);
  return cut.slice(0, cut.lastIndexOf(" ")).trimEnd();
}

// The queue: items nothing has claimed yet, inside the eligibility window, oldest
// first by the outlet's publication time — the feed's own order, so the timeline
// reads the same way round. One over the ceiling, so the caller can report what it
// left behind instead of pretending it posted everything.
async function getSocialQueue(): Promise<SocialItem[]> {
  return await sql<SocialItem[]>`
    select i.id, i.source_id, s.name as source_name, i.title, i.summary,
           i.snippet, i.url, i.tags
    from items i
    join sources s on s.id = i.source_id
    left join social_posts p on p.item_id = i.id
    where p.item_id is null
      and i.ingested_at > now() - ${`${SOCIAL_WINDOW_HOURS} hours`}::interval
    order by i.published_at asc, i.id asc
    limit ${MAX_POSTS_PER_RUN + 1}`;
}

// The other outlets on a cluster survivor, in the same order and with the same
// exclusion as the card's "Also covered by" line. Only what is known at post time —
// clustering can attach an outlet hours later, and a post is never edited after it.
async function getCitations(itemId: number, primarySourceId: number): Promise<Citation[]> {
  return await sql<Citation[]>`
    select s.name, x.url
    from item_sources x join sources s on s.id = x.source_id
    where x.item_id = ${itemId} and x.source_id <> ${primarySourceId}
    order by x.published_at asc`;
}

// Write the intent before the call. Returns 'claimed' when this execution took the
// row, or whatever status was already there when something else did — the caller
// treats 'pending' as "go and look" and every settled status as "leave it alone".
async function claimSocialPost(itemId: number): Promise<string> {
  const inserted = await sql`
    insert into social_posts (item_id, status, attempts)
    values (${itemId}, 'pending', 0)
    on conflict (item_id) do nothing
    returning item_id`;
  if (inserted.length > 0) return "claimed";
  const [row] = await sql<{ status: string }[]>`
    select status from social_posts where item_id = ${itemId}`;
  return row?.status ?? "claimed";
}

async function markSocialPosted(itemId: number, uri: string, cid: string): Promise<null> {
  await sql`
    update social_posts
       set status = 'posted', post_uri = ${uri}, post_cid = ${cid},
           posted_at = now(), last_error = null
     where item_id = ${itemId}`;
  return null;
}

// Each attempt is recorded as it happens, so a row that ends up parked carries how
// many times we tried and what the API last said. `final` is the retry budget being
// spent, not the error being worse.
async function recordSocialFailure(itemId: number, err: string, final: boolean): Promise<null> {
  await sql`
    insert into social_posts (item_id, status, attempts, last_error)
    values (${itemId}, ${final ? "failed" : "pending"}, 1, ${err.slice(0, 500)})
    on conflict (item_id) do update set
      status = ${final ? "failed" : "pending"},
      attempts = social_posts.attempts + 1,
      last_error = ${err.slice(0, 500)}
    where social_posts.status not in ('posted', 'skipped_backfill')`;
  return null;
}

async function triggerRevalidate(): Promise<null> {
  const url = Deno.env.get("REVALIDATE_URL");
  const secret = Deno.env.get("REVALIDATE_SECRET");
  if (!url || !secret) return null;
  try {
    await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* the ISR timer is the backstop */
  }
  return null;
}
