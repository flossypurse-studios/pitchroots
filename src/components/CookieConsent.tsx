"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const CONSENT_KEY = "cookie-consent";

export type Consent = "granted" | "denied" | null;

// The reader's choice lives in localStorage, but it is read through a tiny
// external store rather than a per-component effect. That is the one place
// PitchRoots deliberately differs from the Tamrack original: Tamrack's accept()
// calls window.location.reload() so its analytics component re-reads
// localStorage on a fresh mount, which bounces the page and throws away the
// pageview that prompted the banner in the first place. Here Accept writes the
// choice and notifies subscribers, so <Analytics /> re-renders in place and
// injects the tag on the spot — no reload, and the visit still counts.
//
// One-way in practice: granting mounts the gtag script, but revoking later
// cannot unload a script the browser has already run. Only a reload clears it.
// Same as Tamrack; the banner itself never offers revoke, so it doesn't bite.

const listeners = new Set<() => void>();

// `undefined` means "not read yet"; null is a real value (undecided).
let snapshot: Consent | undefined;

function read(): Consent {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    // private mode — treat as undecided, and the choice just won't persist
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== CONSENT_KEY) return;
  snapshot = read();
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Consent {
  if (snapshot === undefined) snapshot = read();
  return snapshot;
}

// The server cannot know the choice, so it always renders the no-consent view.
// React swaps in the real value right after hydration, so nothing mismatches.
function getServerSnapshot(): Consent {
  return null;
}

function decide(value: Exclude<Consent, null>) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* private mode — honoured for this page, just not remembered */
  }
  snapshot = value;
  notify();
}

export function useCookieConsent(): Consent {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function CookieConsent() {
  const consent = useCookieConsent();
  // Gate on hydration as well as consent: the server snapshot is always null,
  // so without this a returning reader who already decided would see the banner
  // flash in the server HTML before React corrected it.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-card"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted">
          We use Google Analytics to see which stories get read. No advertising,
          no cross-site tracking, and no accounts — decline and nothing is
          measured.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("denied")}
            className="rounded-full border border-line px-3 py-1 font-medium hover:border-pitch hover:text-pitch transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide("granted")}
            className="rounded-full border border-pitch bg-pitch px-3 py-1 font-medium text-background"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
