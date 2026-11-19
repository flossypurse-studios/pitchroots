"use client";

import { useState } from "react";
import { shareIntents } from "@/lib/share";

// Share a story (#561). Plain links and the Web Share API only: no third-party
// scripts, no counters, no pop-up windows, no overlay.
//
// On a touch screen with navigator.share, the button opens the phone's own share
// sheet. Everywhere else it expands an inline panel (SharePanel, rendered by the
// Feed below the story, in the page flow) with ordinary intent links and Copy
// link. The Feed owns which panel is open, so only one is open at a time.

function prefersNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

export function ShareButton({
  url,
  title,
  panelId,
  open,
  onToggle,
}: {
  url: string;
  title: string;
  panelId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const onClick = async () => {
    if (prefersNativeShare()) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // The reader closed the sheet: nothing to do.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Anything else (blocked, unsupported data): fall back to the panel.
      }
    }
    onToggle();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={panelId}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-semibold text-muted hover:border-pitch hover:text-pitch transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
      Share<span className="sr-only"> this story</span>
    </button>
  );
}

export function SharePanel({ id, url, title }: { id: string; url: string; title: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };
  const linkClass =
    "inline-flex min-h-8 items-center rounded-full border border-line px-3 text-sm hover:border-pitch hover:text-pitch transition-colors pointer-coarse:min-h-11";
  return (
    <div id={id} role="group" aria-label="Share this story" className="mt-3 border-t border-line pt-3">
      <ul className="flex flex-wrap gap-2">
        {shareIntents(url, title).map((s) => (
          <li key={s.name}>
            <a href={s.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {s.name}
            </a>
          </li>
        ))}
        <li>
          <button type="button" onClick={copy} className={linkClass}>
            Copy link
          </button>
        </li>
      </ul>
      <p aria-live="polite" className="text-sm text-muted [&:not(:empty)]:mt-2">
        {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy. Here is the link:" : ""}
      </p>
      {status === "failed" && (
        <input
          readOnly
          value={url}
          aria-label="Link to this story"
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 w-full min-w-0 rounded border border-line bg-background px-2 py-1 text-sm"
        />
      )}
    </div>
  );
}
