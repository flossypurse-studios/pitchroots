import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it's built",
  description:
    "PitchRoots is a live example of durable execution: scheduled pipelines that checkpoint every step to Postgres and resume after any crash. Here's how it's built.",
  alternates: { canonical: "/how-it-works" },
};

const DIAGRAM = `  WRITE LOOP  (durable, in the background)   READ LOOP  (every visit)
  ────────────────────────────────────────   ────────────────────────
  pg_cron ── every hour                      you → pitchroots.ca
       │                                          │
       ▼                                     served from the CDN
  poll()  ── a durable workflow                   ▲
       │                                          │  (re-rendered from the
       ├─ fetch each feed                         │   database on a timer, or
       ├─ verify every link                       │   right after new items
       ├─ classify + summarize (AI)               │   are published)
       └─ save new items ─────────────┐           │
                                      │           │
  pg_cron ── every day                │           │
       │                              │           │
       ▼                              │           │
  pollGames()  ── a durable workflow  │           │
       ├─ fetch the box office        │           │
       └─ save every upcoming game ───┤           │
                                      ▼           │
  ┌──────────────────────────────────────────────────────────────────┐
  │  one Postgres database                                           │
  │    · the articles   · the games   · the durable-execution engine │
  └──────────────────────────────────────────────────────────────────┘`;

export default function HowItWorksPage() {
  return (
    <article className="space-y-5 leading-relaxed">
      <h1 className="font-display font-black text-2xl">How PitchRoots is built</h1>

      <p>
        PitchRoots looks like a news feed with a games calendar attached, and to
        read it, it is. Underneath,
        it&apos;s a small but complete example of something called{" "}
        <strong>durable execution</strong> — and since the whole thing is public and
        easy to follow, it doubles as a working demonstration of durable execution.
      </p>

      <h2 className="font-display font-bold text-lg pt-2">Two loops, one database</h2>
      <p>
        There are two independent halves that never talk to each other directly. A{" "}
        <strong>write loop</strong> runs in the background on a schedule, gathering
        and summarizing the news and keeping the games calendar current. A{" "}
        <strong>read loop</strong> serves the website. They meet only at a shared
        database.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-black/[0.03] dark:bg-white/[0.03] p-4">
        <pre className="font-mono text-[11px] leading-snug text-muted whitespace-pre">
          {DIAGRAM}
        </pre>
      </div>
      <p>
        Because all the expensive work happens ahead of time in the write loop, the
        website itself never calls an AI model or fetches a feed while you&apos;re
        looking at it. It just hands you a page that was already built. That&apos;s why
        it&apos;s fast, and why it costs almost nothing to run.
      </p>

      <h2 className="font-display font-bold text-lg pt-2">The hourly job, step by step</h2>
      <p>Every hour, one durable workflow runs, once per news source, and does this:</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li><strong>Fetch</strong> the source&apos;s feed.</li>
        <li><strong>Skip</strong> anything already seen or already rejected — before spending anything on it.</li>
        <li><strong>Verify the link</strong> actually resolves, following redirects and dropping dead ones, so the feed never points at a 404.</li>
        <li><strong>Classify and summarize</strong> what&apos;s left with a language model — deciding whether it&apos;s Canadian soccer, which topics it touches, and writing a one- or two-sentence summary in original words.</li>
        <li><strong>Save</strong> the relevant items, and record the dead links and rejected articles so future runs skip them without asking the AI again.</li>
      </ol>

      <h2 className="font-display font-bold text-lg pt-2">What &ldquo;durable&rdquo; means here</h2>
      <p>
        Each of those steps is <strong>checkpointed to the database the moment it
        finishes.</strong>{" "}
        If the job is interrupted partway — a timeout, a crash, a
        redeploy — it doesn&apos;t start over. It resumes from the last completed step.
        A feed already fetched isn&apos;t fetched again; an article already summarized
        isn&apos;t sent to the AI a second time. The work-in-progress lives in the
        database, not in the memory of a program that might disappear.
      </p>
      <p className="text-muted">
        The precise guarantee is <em>exactly-once checkpointing with at-least-once side
        effects</em> — a step can run again, but it can never leave a duplicate behind,
        because every save is written to be safely repeatable.
      </p>

      <h2 className="font-display font-bold text-lg pt-2">A second workflow: the games calendar</h2>
      <p>
        The{" "}
        <Link href="/games" className="text-pitch underline">
          games calendar
        </Link>{" "}
        is filled in by a second durable workflow, running once a day on the same
        engine inside the same database. It asks the box office — Ticketmaster&apos;s
        public events listing — for every upcoming soccer event in Canada, sorts what
        comes back into competitions, and saves each game under the box office&apos;s
        own id for it. Fixtures move, so a rescheduled kickoff, a new venue, or a
        cancellation simply overwrites the row on the next sync, and a step that runs
        twice writes the same values twice.
      </p>
      <p className="text-muted">
        There is no AI in that job at all — the listings arrive structured, and working
        out that one of them is a CPL home game is ordinary code. Same machinery, a
        different problem: durability is about surviving interruption around calls to
        the outside world, and the language model in the news pipeline is incidental
        to it.
      </p>

      <h2 className="font-display font-bold text-lg pt-2">The unusual part: no separate server</h2>
      <p>
        Normally, durable execution needs its own workflow server running somewhere.
        PitchRoots doesn&apos;t have one. The entire engine —{" "}
        <a href="https://github.com/resonatehq/resonate-pg" className="text-pitch underline">
          resonate-pg
        </a>{" "}
        — is a single SQL file that runs <em>inside the same Postgres database</em> that
        stores the articles. Postgres itself keeps time and triggers the hourly run. So
        the whole system is really just a static website and a database — with the
        reliability of a workflow engine folded into the database itself.
      </p>

      <p className="pt-2">
        This is all built on{" "}
        <a href="https://www.resonatehq.io" className="text-pitch underline">
          Resonate
        </a>{" "}
        durable execution. If you&apos;re curious about the machinery, the{" "}
        <a href="https://github.com/flossypurse/pitchroots" className="text-pitch underline">
          source is public
        </a>
        .
      </p>

      <p className="pt-4 text-sm">
        <Link href="/news" className="text-pitch underline">← Back to the feed</Link>
      </p>
    </article>
  );
}
