import { listWatchlist, removeFromWatchlist } from "@/lib/property-watch";
import { deps } from "@/lib/wiring";

export async function removeFromWatchlistCommand(args: string[]): Promise<void> {
  const watchedPropertyId = Number(args[0]);

  if (!Number.isInteger(watchedPropertyId) || watchedPropertyId <= 0) {
    console.error("Usage: remove-from-watchlist <watched-property-id>");
    process.exitCode = 1;
    return;
  }

  const entry = listWatchlist(deps.watchedPropertyRepo).find((watched) => watched.id === watchedPropertyId);
  if (!entry) {
    console.error(`No watched property with id ${watchedPropertyId}.`);
    process.exitCode = 1;
    return;
  }

  removeFromWatchlist(deps.watchedPropertyRepo, watchedPropertyId);
  console.log(`Removed "${entry.address}" from the watch list.`);
}
