import { getWatchlistHistory } from "@/lib/property-watch";
import { formatCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

export async function watchlistHistoryCommand(args: string[]): Promise<void> {
  const watchedPropertyId = Number(args[0]);

  if (!Number.isInteger(watchedPropertyId) || watchedPropertyId <= 0) {
    console.error("Usage: watchlist-history <watched-property-id>");
    process.exitCode = 1;
    return;
  }

  const history = getWatchlistHistory(deps.watchedPropertyRepo, watchedPropertyId);

  if (history.length === 0) {
    console.log("No snapshots for this watched property.");
    return;
  }

  for (const snapshot of history) {
    console.log(
      `${snapshot.fetchedAt} — ${snapshot.squareFootage ?? "?"} sqft${
        snapshot.taxAssessedValueCents !== undefined
          ? `, tax assessment ${formatCents(snapshot.taxAssessedValueCents)}`
          : ""
      }${
        snapshot.lastSalePriceCents !== undefined
          ? `, last sale ${formatCents(snapshot.lastSalePriceCents)} (${snapshot.lastSaleDate})`
          : ""
      }`,
    );
  }
}
