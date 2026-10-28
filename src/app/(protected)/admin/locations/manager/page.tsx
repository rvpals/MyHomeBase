import { Suspense } from "react";
import {
  countLocationsByCategory,
  countLocationsByTag,
  listSavedLocations,
} from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { locationTaxonomyIconMap } from "../icon-map";
import { LocationManagerView } from "./view";

/**
 * Administration → Locations → Location Manager: the application-wide library of
 * saved places (migration 0140).
 *
 * Application-wide rather than a module's: these places are meant to be picked
 * from several modules, so none of them owns the tables. The Journal's own
 * Location Manager still reads its `jrn_location*` family and is phased out
 * separately.
 *
 * Admin-only. The route layout redirects non-admins, and every action re-checks
 * on its own first line, because an action is its own endpoint.
 */
export default async function LocationManagerPage() {
  // The counts feed the filter chips; the manager needs only the names, but
  // reading them from the same two calls keeps this screen and the Meta Data
  // one from disagreeing about which lists exist.
  return (
    // The view reads `?edit=<id>` — how Journal → Saved Locations hands a place
    // over to be corrected — and `useSearchParams` must sit under a Suspense
    // boundary or it opts the whole route out of static rendering at build time.
    //
    // No fallback worth drawing: the data is already in hand, so the boundary
    // resolves on the first paint and anything here would be a flash.
    <Suspense>
      <LocationManagerView
        locations={listSavedLocations(deps.sysLocationRepo)}
        categoryOptions={countLocationsByCategory(deps.sysLocationRepo).map((row) => row.name)}
        tagOptions={countLocationsByTag(deps.sysLocationRepo).map((row) => row.name)}
        categoryIcons={locationTaxonomyIconMap("category")}
        tagIcons={locationTaxonomyIconMap("tag")}
      />
    </Suspense>
  );
}
