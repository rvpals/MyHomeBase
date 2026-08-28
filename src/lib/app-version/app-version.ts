import type { BuildIdRepository } from "./ports";
import type { AppVersion } from "./types";

// Reads the identity of the build this server is running.
//
// The point of the whole module: an installed PWA is *suspended*, not closed, so
// bringing it back to the foreground reuses the JavaScript it loaded days ago
// and never asks the server whether that is still current. Handing the client
// the build ID it booted with, and an endpoint serving the ID the server has
// now, lets it notice the difference and reload itself.
export function getAppVersion(repo: BuildIdRepository): AppVersion {
  const raw = repo.readBuildId();
  const buildId = raw?.trim();
  // Empty or whitespace-only is as unusable as absent -- collapse both to null
  // so callers have exactly one "unknown" to handle.
  return { buildId: buildId ? buildId : null };
}

/**
 * Whether the client should be told a new version is available.
 *
 * Both unknowns are deliberately "no": in `next dev` there is no BUILD_ID, so a
 * truthy answer here would nag on every foreground with no reload that could
 * ever satisfy it. A failed fetch also arrives as `null` (offline, or the server
 * mid-restart) and must not be read as "updated" -- being silently wrong toward
 * "no prompt" is recoverable, the other direction is a reload loop.
 */
export function isUpdateAvailable(bootBuildId: string | null, serverBuildId: string | null): boolean {
  if (!bootBuildId || !serverBuildId) return false;
  return bootBuildId !== serverBuildId;
}

/**
 * The URL to reload to, given the one currently showing.
 *
 * A cache-busting query parameter, because the reload has to defeat caches this
 * code cannot reach: `location.reload()` may be served from the HTTP cache, and
 * an installed PWA's document request is exactly the one that goes stale. A URL
 * the cache has never seen cannot be answered from it.
 *
 * `input` is a full URL; the returned string is too. The stamp replaces any
 * previous one rather than appending, so repeated reloads don't grow the query
 * string, and every other parameter is preserved -- the current page's filters
 * and ids survive the refresh.
 */
export function cacheBustedUrl(input: string, stamp: number): string {
  const url = new URL(input);
  url.searchParams.set(CACHE_BUST_PARAM, String(stamp));
  return url.toString();
}

/** The query parameter `cacheBustedUrl` sets, and the client strips after load. */
export const CACHE_BUST_PARAM = "__v";

/**
 * The same URL with the cache-buster taken back out, for `history.replaceState`
 * after the reload has served its purpose. Keeping it in the address bar would
 * leak into every bookmark and shared link.
 *
 * Returns `null` when there was no stamp to remove, so the caller can skip a
 * pointless history write on the overwhelmingly common normal page load.
 */
export function urlWithoutCacheBuster(input: string): string | null {
  const url = new URL(input);
  if (!url.searchParams.has(CACHE_BUST_PARAM)) return null;
  url.searchParams.delete(CACHE_BUST_PARAM);
  return url.toString();
}
