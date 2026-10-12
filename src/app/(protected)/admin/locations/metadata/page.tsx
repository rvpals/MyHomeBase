import { CollapsibleCard } from "@/components/collapsible-card";
import {
  countLocationsByCategory,
  countLocationsByTag,
  listLocationCategories,
  listLocationTags,
} from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { LocationTaxonomyView } from "./view";

/**
 * Administration → Locations → Location Meta Data: the categories and tags that
 * say what a place *is*, and the icons that stand for them (migration 0140).
 *
 * These two lists were carried over from the Journal's own location taxonomy by
 * that migration, icons and all. Admin-only, like the other two screens here.
 */
export default async function LocationMetadataPage() {
  // The editor wants both halves: the descriptions (from the taxonomy rows) and
  // the usage counts (from the count queries). Joined here by name rather than
  // in a third repository method, since this is the only screen that needs them
  // together.
  //
  // iconMimeType and updatedAt ride along so the list can build each row's icon
  // URL — the mime type says whether there *is* one, updatedAt busts the cache
  // when it's replaced. The bytes stay behind the route.
  const withCounts = (
    rows: {
      name: string;
      description: string;
      iconMimeType?: string;
      updatedAt: string;
    }[],
    counts: { name: string; count: number }[],
  ) =>
    rows.map((row) => ({
      name: row.name,
      description: row.description,
      iconMimeType: row.iconMimeType,
      updatedAt: row.updatedAt,
      count: counts.find((entry) => entry.name === row.name)?.count ?? 0,
    }));

  // In a card, open by default — the same presentation the Journal's copy gets,
  // since it is the same kind of screen.
  return (
    <CollapsibleCard title="Location categories & tags" defaultOpen>
      <LocationTaxonomyView
        categories={withCounts(
          listLocationCategories(deps.sysLocationRepo),
          countLocationsByCategory(deps.sysLocationRepo),
        )}
        tags={withCounts(
          listLocationTags(deps.sysLocationRepo),
          countLocationsByTag(deps.sysLocationRepo),
        )}
      />
    </CollapsibleCard>
  );
}
