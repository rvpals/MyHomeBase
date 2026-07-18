import { addToWatchlist, lookupProperty } from "@/lib/property-watch";
import { deps } from "@/lib/wiring";

export async function watchPropertyCommand(args: string[]): Promise<void> {
  const address = args.join(" ");

  if (!deps.propertyLookupClient) {
    console.error("Property lookup isn't configured (set RENTCAST_API_KEY).");
    process.exitCode = 1;
    return;
  }

  try {
    const details = await lookupProperty(deps.propertyLookupClient, address);
    const { watchedProperty } = addToWatchlist(deps.watchedPropertyRepo, address, details);
    console.log(`Watching "${watchedProperty.address}" (id ${watchedProperty.id}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to add property to watch list.");
    process.exitCode = 1;
  }
}
