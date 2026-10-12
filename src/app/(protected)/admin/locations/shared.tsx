import type { LocationTaxonomyKind } from "@/lib/sys-locations";

/**
 * The URL serving a location category's or tag's uploaded icon, or undefined
 * when it has none.
 *
 * `iconMimeType` is the "is there one?" flag -- the bytes themselves never ride
 * on a list payload, so its presence is what the caller has to go on.
 *
 * `updatedAt` rides along as a cache-buster: the path is keyed by name, so
 * replacing an icon would otherwise keep serving the browser's cached copy.
 *
 * Mirrors the journal's `locationTaxonomyIconUrl` against the /admin routes --
 * see migration 0140.
 *
 * This file must stay free of any `@/lib/wiring` import, directly or
 * transitively. The Meta Data view is a client component and imports this
 * builder, so everything reachable from here is pulled into the browser
 * bundle -- and `deps` drags in better-sqlite3 and sharp, which cannot resolve
 * `fs` there. The server-only read that *uses* this lives in `icon-map.ts`.
 */
export function locationTaxonomyIconUrl(
  kind: LocationTaxonomyKind,
  item: { name: string; iconMimeType?: string; updatedAt: string },
): string | undefined {
  if (!item.iconMimeType) return undefined;
  const path = kind === "category" ? "categories" : "tags";
  return `/api/admin/locations/${path}/${encodeURIComponent(item.name)}/icon?v=${encodeURIComponent(item.updatedAt)}`;
}
