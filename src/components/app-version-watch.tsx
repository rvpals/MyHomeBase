"use client";

// Notices when this client is running an older build than the server serves, and
// reloads hard enough to actually pick up the new one.
//
// The problem it solves: installed to a home screen, the app is *suspended* when
// you switch away, not closed. Reopening it resumes the same document with the
// same JavaScript it loaded days ago -- it never makes a fresh request, so a
// deployment that is live on your desktop stays invisible on your phone.
//
// So the check runs on `visibilitychange`: the moment the app comes back to the
// foreground is exactly the moment it might be stale, and it is also the only
// moment a suspended app runs any code at all. There is no polling -- a
// backgrounded PWA would not run the timer anyway, and a foregrounded one is
// already being watched.
//
// Renders nothing until the builds actually differ.

import { useCallback, useEffect, useState } from "react";
import {
  cacheBustedUrl,
  isUpdateAvailable,
  urlWithoutCacheBuster,
  type AppVersion,
} from "@/lib/app-version";

/**
 * Clears every cache this page is allowed to touch, then reloads onto a URL no
 * cache has seen.
 *
 * Exported because the "Clear cache & relaunch" button on Admin -> About calls
 * the same routine -- the manual control and the automatic prompt must not drift
 * into two different definitions of "refresh".
 *
 * Note the honest limit: a page can clear the Cache Storage API and unregister
 * service workers, but **nothing can reach the browser's own HTTP cache**. The
 * cache-busting URL is what covers that, by asking for a URL the HTTP cache has
 * no entry for.
 */
export async function clearCachesAndReload(): Promise<void> {
  // Both of these are no-ops today: the app registers no service worker. They
  // are here because the failure they would prevent is invisible and confusing
  // -- if a service worker is ever added, this button silently stops working
  // without them, and a "Clear cache" that does not clear the cache is worse
  // than no button. Each is guarded and swallowed: unsupported or blocked
  // (Safari private browsing throws on both) must not stop the reload.
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Ignored -- reloading matters more than a clean cache sweep.
  }

  try {
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Ignored, same reasoning.
  }

  // `replace`, not `assign`: the stale page should not sit in history one Back
  // press away. `Date.now()` because the stamp only has to be a value this
  // browser has not requested before, not a real version.
  window.location.replace(cacheBustedUrl(window.location.href, Date.now()));
}

async function fetchServerBuildId(): Promise<string | null> {
  try {
    // `cache: "no-store"` as well as the endpoint's own no-store headers: this
    // one is about *this fetch*, and it is the half we control from the stale
    // client, which is the side that might be misbehaving.
    const response = await fetch("/api/app-version", { cache: "no-store" });
    if (!response.ok) return null;
    const version = (await response.json()) as AppVersion;
    return version.buildId ?? null;
  } catch {
    // Offline, or the server is mid-restart during a deploy -- which is exactly
    // when this fires and precisely when a false "updated" would be worst.
    return null;
  }
}

export interface AppVersionWatchProps {
  /**
   * The build id this document was served by. Captured server-side at render, so
   * it ages with the document rather than with the request -- which is the whole
   * comparison.
   */
  bootBuildId: string | null;
}

export function AppVersionWatch({ bootBuildId }: AppVersionWatchProps) {
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);

  // Take the cache-buster back out of the address bar after a reload has used
  // it. Left in, it would end up in bookmarks and shared links, and would make
  // every post-refresh URL look like an app implementation detail.
  useEffect(() => {
    const cleaned = urlWithoutCacheBuster(window.location.href);
    if (cleaned) window.history.replaceState(null, "", cleaned);
  }, []);

  useEffect(() => {
    // Nothing to compare against: `next dev` has no BUILD_ID. Skip the listener
    // entirely rather than fetching on every foreground to no purpose.
    if (!bootBuildId) return;

    let cancelled = false;

    async function check() {
      const serverBuildId = await fetchServerBuildId();
      if (cancelled) return;
      if (isUpdateAvailable(bootBuildId, serverBuildId)) setUpdateReady(true);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void check();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Deliberately not checking on mount: this document was just served, so it
    // is current by definition. The interesting event is always a *later*
    // foreground.
  }, [bootBuildId]);

  const onReload = useCallback(() => {
    setReloading(true);
    void clearCachesAndReload();
  }, []);

  if (!updateReady) return null;

  return (
    // Pinned to the *top* edge, not the bottom: the bottom already carries the
    // compact section trigger and the music player, both stacking on published
    // heights (see design.md -> "Adding a UI element to the shell"). A third
    // claimant there would need its own variable and `.app-main` reservation for
    // a bar that is gone seconds later. z-40 keeps it under Modal's z-50.
    //
    // Transient, so it deliberately does *not* reserve layout space -- it
    // overlays the header for the few seconds it exists rather than shoving
    // every page down.
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-3 border-b border-line bg-paper-raised px-4 py-2 shadow-lg max-lg:justify-between"
      // The app paints under the Dynamic Island, so the top inset is ours to pad
      // -- without it the text sits behind the status bar on an installed phone.
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      <p className="text-sm text-ink">A new version is available.</p>
      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        // Not the shared `Button`: at `size="sm"` its hard-offset shadow and
        // lift-on-hover read as a page action, and this is a one-line inline
        // link inside a notification strip. Kept to theme tokens all the same.
        className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-brass-dark underline decoration-brass-soft underline-offset-2 transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none"
      >
        {reloading ? "Reloading…" : "Reload now"}
      </button>
      <button
        type="button"
        onClick={() => setUpdateReady(false)}
        // Dismissible on purpose: an unskippable reload prompt mid-edit would
        // lose whatever was being typed. It returns on the next foreground.
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 rounded-full px-2 py-1 text-sm text-muted transition-opacity hover:opacity-80 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none"
      >
        ✕
      </button>
    </div>
  );
}
