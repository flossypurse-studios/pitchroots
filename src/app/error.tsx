"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

// Renders inside the root layout, so the header and footer stay put. In
// production `error.message` is replaced by a generic string for anything thrown
// on the server, and we never show it anyway — readers get what happened and what
// to do; the digest is there to match a report against the server logs.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[pitchroots] page error", error.digest ?? "", error);
  }, [error]);

  return (
    <article className="space-y-4 leading-relaxed">
      <h1 className="font-display font-black text-2xl">This page didn&apos;t load</h1>
      <p>
        Something went wrong on our side while building this page. The feed itself is
        fine — trying again usually works.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-full bg-pitch px-4 py-2 text-sm font-semibold text-background hover:bg-pitch-strong"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:text-pitch"
        >
          Back to the feed
        </Link>
      </div>
      <p className="text-sm text-muted">
        Still broken? Tell us at{" "}
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
  );
}
