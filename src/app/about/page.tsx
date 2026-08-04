import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "What PitchRoots is and how the feed works.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <article className="space-y-4 leading-relaxed">
      <h1 className="font-display font-black text-2xl">About PitchRoots</h1>
      <p>
        PitchRoots is a Canada-wide soccer news feed. It answers one question:{" "}
        <em>what&apos;s happening in Canadian soccer today?</em> — across the national
        teams, the Canadian Premier League, the Northern Super League, Canada&apos;s MLS
        clubs, League1, and the provincial game.
      </p>
      <p>
        Every item is a headline, a short summary written in our own words, and a link
        to the original publisher. We are a router, not a destination: the full story
        always lives with the source, and we send you there.
      </p>
      <h2 className="font-display font-bold text-lg pt-2">How it works</h2>
      <p>
        The feed checks a curated list of Canadian soccer sources every hour — national
        media, league sites, independent outlets, and club news. Items are filtered for
        Canadian relevance, tagged, and summarized. There are no accounts and no
        paywall; read it on the site or subscribe by{" "}
        <a href="/feed.xml" className="text-pitch underline">RSS</a>.
      </p>
      <h2 className="font-display font-bold text-lg pt-2">How it&apos;s built</h2>
      <p>
        The feed rebuilds itself every hour with a durable workflow — a live example of{" "}
        <a href="https://www.resonatehq.io" className="text-pitch underline">
          Resonate
        </a>{" "}
        durable execution running inside the database, with no separate workflow
        server.{" "}
        <a href="/how-it-works" className="text-pitch underline">
          Here&apos;s the full explanation →
        </a>
      </p>
      <h2 className="font-display font-bold text-lg pt-2">For publishers</h2>
      <p>
        We link out prominently and never republish article text or images. If you run a
        source we cover and want your coverage adjusted or removed, email{" "}
        <a href="mailto:hello@pitchroots.ca" className="text-pitch underline">
          hello@pitchroots.ca
        </a>{" "}
        and we&apos;ll act the same day.
      </p>
    </article>
  );
}
