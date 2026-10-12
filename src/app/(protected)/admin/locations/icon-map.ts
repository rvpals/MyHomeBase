import {
  listLocationCategories,
  listLocationTags,
  type LocationTaxonomyKind,
} from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { locationTaxonomyIconUrl } from "./shared";

/**
 * Name -> icon URL for one taxonomy list. Names without an uploaded icon are
 * simply absent, which is what the views check.
 *
 * Its own file, apart from the URL builder in `shared.tsx`, because it reads
 * the database: `deps` reaches better-sqlite3 and sharp, and anything a client
 * component can import must not. `shared.tsx` is imported by the Meta Data
 * view, which *is* a client component -- keeping the two in one file put the
 * native modules in the browser bundle and broke the production build.
 *
 * Nothing enforces that mechanically -- the `server-only` package is not a
 * dependency here -- so the rule is this comment plus the one in `shared.tsx`:
 * never import this file from a component carrying "use client".
 *
 * A plain record rather than a Map because it crosses the server/client
 * boundary into a client component, and a Map does not survive that
 * serialization.
 */
export function locationTaxonomyIconMap(kind: LocationTaxonomyKind): Record<string, string> {
  const rows =
    kind === "category"
      ? listLocationCategories(deps.sysLocationRepo)
      : listLocationTags(deps.sysLocationRepo);
  const urls: Record<string, string> = {};
  for (const row of rows) {
    const url = locationTaxonomyIconUrl(kind, row);
    if (url) urls[row.name] = url;
  }
  return urls;
}
