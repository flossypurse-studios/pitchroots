import type { Metadata, Viewport } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@/components/Analytics";
import { CookieConsent } from "@/components/CookieConsent";
import { NavPills } from "@/components/NavPills";
import { ThemeToggle } from "@/components/ThemeToggle";
import { gameCompetitionsPresent } from "@/lib/db";
import { GAME_TAGS, TAGS } from "@/lib/tags";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
});

const SITE = process.env.SITE_URL ?? "https://pitchroots.ca";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "PitchRoots — Canadian soccer news, one feed",
    template: "%s — PitchRoots",
  },
  description:
    "What's happening in Canadian soccer today. Curated headlines from across the country — CanMNT, CanWNT, CPL, NSL, MLS, League1 and more — always linking to the source.",
  openGraph: {
    siteName: "PitchRoots",
    type: "website",
    locale: "en_CA",
    url: "/",
    title: "PitchRoots — Canadian soccer news, one feed",
    description:
      "Curated Canadian soccer headlines — national teams, CPL, NSL, MLS, League1 and the provincial game — always linking to the source.",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    types: { "application/rss+xml": "/feed.xml" },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#141810" },
  ],
};

const FOOTER_GROUPS: { heading: string; slugs: string[] }[] = [
  {
    heading: "Follow",
    slugs: ["canmnt", "canwnt", "canpl", "nsl", "mls", "league1", "world-cup", "canadian-championship", "womens", "youth"],
  },
  {
    heading: "By province",
    slugs: TAGS.filter((t) => t.group === "province").map((t) => t.slug),
  },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The games calendar surfaces sitewide (nav pill, footer links) only once the
  // daily sync has actual upcoming games — an empty calendar linked from every
  // page is worse than no calendar. Per-competition, for the same reason: only
  // competitions with upcoming dates get links. Re-checked on every revalidate.
  const gameCompetitions = await gameCompetitionsPresent();
  const showGames = gameCompetitions.length > 0;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Re-stamp a saved theme choice before anything paints, so a reader who
            picked the non-system theme never sees a flash of the wrong one. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
        <header className="border-b-4 border-pitch">
          <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4">
            <div className="flex items-start justify-between gap-4">
              <Link href="/" className="inline-block">
                <span className="font-display font-black text-3xl tracking-tight">
                  Pitch<span className="text-pitch">Roots</span>
                </span>
              </Link>
              <ThemeToggle />
            </div>
            {/* Hidden on mobile: the tagline costs two wrapped lines there, and the
                title tag + meta description already carry it for first-time arrivals. */}
            <p className="mt-1 hidden text-sm text-muted sm:block">
              Canadian soccer, one feed. Every story links to its source.
            </p>
            <NavPills gameCompetitions={gameCompetitions} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 text-sm text-muted space-y-4">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <span className="font-semibold">{group.heading}:</span>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {group.slugs.map((slug) => {
                    const t = TAGS.find((x) => x.slug === slug);
                    if (!t) return null;
                    return (
                      <Link key={slug} href={`/news/${slug}`} className="hover:text-pitch">
                        {t.group === "province" ? t.label : `${t.label} news`}
                      </Link>
                    );
                  })}
                </div>
              </nav>
            ))}
            {showGames && (
              <nav aria-label="Game tickets">
                <span className="font-semibold">Game tickets:</span>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {GAME_TAGS.filter((t) => gameCompetitions.includes(t.slug)).map((t) => (
                    <Link key={t.slug} href={`/games/${t.slug}`} className="hover:text-pitch">
                      {`${t.shortLabel ?? t.label} games`}
                    </Link>
                  ))}
                </div>
              </nav>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-line">
              {showGames && (
                <Link href="/games" className="hover:text-pitch">Games &amp; tickets</Link>
              )}
              <Link href="/about" className="hover:text-pitch">About</Link>
              <Link href="/how-it-works" className="hover:text-pitch">How it&apos;s built</Link>
              <a href="/feed.xml" className="hover:text-pitch">RSS</a>
              <a href="mailto:hello@pitchroots.ca" className="hover:text-pitch">hello@pitchroots.ca</a>
              <span>Headlines and summaries link out to the original publishers.</span>
            </div>
            <div className="pt-2 border-t border-line">
              <a
                href="https://flossypurse.studio"
                className="inline-flex items-center gap-2 opacity-80 hover:opacity-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 128 128"
                  width={16}
                  height={16}
                  role="img"
                  aria-label="FlossyPurse Studios"
                >
                  <title>FlossyPurse Studios</title>
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    transform="translate(-5 -1) rotate(-34 65 64)"
                    d="M112 64 C100 38 66 36 44 55 L23 37 L17 44 L36 64 L17 84 L23 91 L44 73 C66 94 100 92 112 64 Z M95 56 A5 5 0 1 1 85 56 A5 5 0 1 1 95 56 Z"
                  />
                </svg>
                <span>A FlossyPurse Studios project</span>
              </a>
            </div>
          </div>
        </footer>
        {/* Analytics renders nothing until the reader accepts; the banner shows
            itself only while the choice is still unmade. */}
        <Analytics />
        <CookieConsent />
      </body>
    </html>
  );
}
