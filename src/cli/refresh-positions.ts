import { refreshAllPositions } from "@/lib/stock-positions";
import { deps } from "@/lib/wiring";

export async function refreshPositionsCommand(): Promise<void> {
  const { refreshed, failed } = await refreshAllPositions(deps.stockPositionRepo, deps.marketDataClient);

  console.log(`Refreshed ${refreshed.length} position(s).`);
  for (const failure of failed) {
    console.error(`  ${failure.ticker}: ${failure.error}`);
  }

  if (failed.length > 0) process.exitCode = 1;
}
