import { refreshWatchedProperty } from "@/lib/property-watch";
import { deps } from "@/lib/wiring";

export async function refreshWatchlistCommand(args: string[]): Promise<void> {
  const watchedPropertyId = Number(args[0]);

  if (!Number.isInteger(watchedPropertyId) || watchedPropertyId <= 0) {
    console.error("Usage: refresh-watchlist <watched-property-id>");
    process.exitCode = 1;
    return;
  }

  if (!deps.propertyLookupClient) {
    console.error("Property lookup isn't configured (set RENTCAST_API_KEY).");
    process.exitCode = 1;
    return;
  }

  try {
    const snapshot = await refreshWatchedProperty(
      deps.watchedPropertyRepo,
      deps.propertyLookupClient,
      watchedPropertyId,
    );
    console.log(`Recorded new snapshot ${snapshot.id} at ${snapshot.fetchedAt}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to refresh property.");
    process.exitCode = 1;
  }
}
