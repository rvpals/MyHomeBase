import { calculatePeriodChanges } from "@/lib/stock-positions";
import { listPositions } from "@/lib/stock-positions";
import type { PeriodType } from "@/lib/stock-positions";
import { deps } from "@/lib/wiring";
import { requireUser } from "@/app/(protected)/require-access";

export async function POST(request: Request) {
  await requireUser();

  const { period } = (await request.json()) as { period: PeriodType };

  if (!["week", "month", "year"].includes(period)) {
    return Response.json({ ok: false, error: "Invalid period" }, { status: 400 });
  }

  try {
    const positions = listPositions(deps.stockPositionRepo);
    const { gainers, losers } = await calculatePeriodChanges(
      positions,
      deps.marketDataClient,
      period,
    );

    return Response.json({
      ok: true,
      gainers,
      losers,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to calculate changes",
      },
      { status: 500 },
    );
  }
}
