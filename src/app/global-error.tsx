"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import "./globals.css";

// The last line of defence: shown when the root layout itself fails — which for
// this site mostly means the database read the layout does for the games nav. It
// replaces the root layout, so it brings its own <html>/<body>, the brand palette
// from globals.css, and a plain wordmark. No next/font here: if the layout broke,
// keep this page's dependencies to the stylesheet alone (system fonts fall in).
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[pitchroots] root error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Something went wrong — PitchRoots</title>
        <header className="border-b-4 border-pitch">
          <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4">
            <a href="/" className="inline-block">
              <span className="font-black text-3xl tracking-tight">
                Pitch<span className="text-pitch">Roots</span>
              </span>
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
          <article className="space-y-4 leading-relaxed">
            <h1 className="font-black text-2xl">PitchRoots is having a moment</h1>
            <p>
              The site couldn&apos;t load just now. This is on our side, not yours, and
              it&apos;s usually brief.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => unstable_retry()}
                className="rounded-full bg-pitch px-4 py-2 text-sm font-semibold text-background hover:bg-pitch-strong"
              >
                Try again
              </button>
              {/* A plain <a>, not <Link>: a full reload is the point here. */}
              <a
                href="/"
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:text-pitch"
              >
                Reload the feed
              </a>
            </div>
            <p className="text-sm text-muted">
              Still down? Tell us at{" "}
              <a href="mailto:hello@pitchroots.ca" className="text-pitch underline">
                hello@pitchroots.ca
              </a>
              {error.digest ? (
                <>
                  {" "}and quote <code className="font-mono">{error.digest}</code>.
                </>
              ) : (
                "."
              )}
            </p>
          </article>
        </main>
      </body>
    </html>
  );
}
