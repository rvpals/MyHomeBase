import { getWatchlistHistory, listWatchlist } from "@/lib/property-watch";
import { deps } from "@/lib/wiring";

export async function listWatchlistCommand(): Promise<void> {
  const watched = listWatchlist(deps.watchedPropertyRepo);

  if (watched.length === 0) {
    console.log("Watch list is empty.");
    return;
  }

  for (const entry of watched) {
    const history = getWatchlistHistory(deps.watchedPropertyRepo, entry.id);
    const latest = history[0];
    console.log(
      `#${entry.id} ${entry.address} — ${history.length} snapshot(s)${
        latest ? `, last fetched ${latest.fetchedAt}` : ""
      }`,
    );
  }
}
