import type { Metadata } from "next";
import Link from "next/link";
import { Feed } from "@/components/Feed";
import { latestItems } from "@/lib/db";

export const revalidate = 900;

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/feed.xml" },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "PitchRoots",
      description: "Canadian soccer news, one feed.",
      inLanguage: "en-CA",
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "PitchRoots",
      url: SITE,
      email: "hello@pitchroots.ca",
      logo: `${SITE}/opengraph-image`,
    },
  ],
};

export default async function HomePage() {
  const items = await latestItems({ limit: 100 });
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {/* Deliberately a small section label rather than a display heading: the
          card headlines are the page's real visual anchors, and the h1 exists to
          name the page for semantics and search, not to compete with them. */}
      <h1 className="font-display font-bold text-sm uppercase tracking-widest text-pitch mb-4">
        The latest in Canadian soccer
      </h1>
      <Feed items={items} />
      <p className="mt-8 pt-4 border-t border-line text-xs text-muted">
        This feed rebuilds itself every hour with a durable workflow.{" "}
        <Link href="/how-it-works" className="hover:text-pitch underline">
          See how it&apos;s built →
        </Link>
      </p>
    </>
  );
}
