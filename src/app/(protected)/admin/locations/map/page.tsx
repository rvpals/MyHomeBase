import {
  countLocationsByCategory,
  countLocationsByTag,
  listSavedLocations,
} from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { locationTaxonomyIconMap } from "../icon-map";
import { LocationMapView } from "./view";

/**
 * Administration → Locations → Location Map: every saved place on one map,
 * filtered by category and tag (migration 0140).
 *
 * Admin-only, like the Manager beside it.
 */
export default async function LocationMapPage() {
  // The same list the manager reads. The map filters it down client-side
  // through the search action, so the server hands over the unfiltered set
  // once rather than on every chip.
  return (
    <LocationMapView
      locations={listSavedLocations(deps.sysLocationRepo)}
      categoryOptions={countLocationsByCategory(deps.sysLocationRepo).map((row) => row.name)}
      tagOptions={countLocationsByTag(deps.sysLocationRepo).map((row) => row.name)}
      categoryIcons={locationTaxonomyIconMap("category")}
      tagIcons={locationTaxonomyIconMap("tag")}
    />
  );
}
