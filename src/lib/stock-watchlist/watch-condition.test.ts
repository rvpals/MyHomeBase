import { describe, expect, it } from "vitest";
import type { MarketEvent } from "@/lib/market-data";
import type { StockWatchListItem, WatchKindOrNone } from "./types";
import {
  PRICE_TARGET_BAND_PCT,
  eventDateIso,
  evaluateEventWatch,
  evaluatePriceWatch,
  priceSwing,
  summarizeWatch,
} from "./watch-condition";

/**
 * A watched row. Every test states only the fields its case turns on, which is
 * what keeps the intent of each one readable.
 */
function item(overrides: Partial<StockWatchListItem> = {}): StockWatchListItem {
  return {
    id: 1,
    watchListId: 1,
    ticker: "NVDA",
    shares: 0,
    priceWhenAddedCents: 10_000, // $100.00
    addedDate: "2026-01-01",
    reminderMessage: "",
    watchKind: "price" as WatchKindOrNone,
    watchValue: 0,
    watchValueHigh: 0,
    watchIsTriggered: false,
    watchLastMessage: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Epoch seconds for a "YYYY-MM-DD", at midday UTC to dodge any edge rounding. */
function at(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00.000Z`) / 1000);
}

describe("evaluatePriceWatch — price", () => {
  const watching = item({ watchKind: "price", watchValue: 10_000 });

  it("fires when the price reaches the target", () => {
    const result = evaluatePriceWatch(watching, 10_000);
    expect(result.isActive).toBe(true);
    expect(result.shouldNotify).toBe(true);
    expect(result.message).toContain("$100.00");
  });

  it("fires when the price arrives from above, not only from below", () => {
    // The target band is symmetric: a reader waiting for a fall to $100 is as
    // ordinary as one waiting for a rise to it.
    const band = (10_000 * PRICE_TARGET_BAND_PCT) / 100;
    expect(evaluatePriceWatch(watching, 10_000 + band).isActive).toBe(true);
    expect(evaluatePriceWatch(watching, 10_000 - band).isActive).toBe(true);
  });

  it("stays quiet while the price is outside the band", () => {
    const outside = 10_000 + (10_000 * PRICE_TARGET_BAND_PCT) / 100 + 1;
    const result = evaluatePriceWatch(watching, outside);
    expect(result.isActive).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });

  it("stays active but silent once already reported — the latch", () => {
    const result = evaluatePriceWatch({ ...watching, watchIsTriggered: true }, 10_000);
    expect(result.isActive).toBe(true);
    expect(result.shouldNotify).toBe(false);
  });

  it("is inert when no target was set", () => {
    expect(evaluatePriceWatch(item({ watchKind: "price", watchValue: 0 }), 10_000).isActive).toBe(
      false,
    );
  });
});

describe("evaluatePriceWatch — price_range", () => {
  const watching = item({ watchKind: "price_range", watchValue: 1_000, watchValueHigh: 1_500 });

  it("fires inside the range, including at both ends", () => {
    expect(evaluatePriceWatch(watching, 1_200).isActive).toBe(true);
    expect(evaluatePriceWatch(watching, 1_000).isActive).toBe(true);
    expect(evaluatePriceWatch(watching, 1_500).isActive).toBe(true);
  });

  it("stays quiet outside the range on either side", () => {
    expect(evaluatePriceWatch(watching, 999).isActive).toBe(false);
    expect(evaluatePriceWatch(watching, 1_501).isActive).toBe(false);
  });

  it("is inert when the range is inverted", () => {
    const inverted = item({ watchKind: "price_range", watchValue: 1_500, watchValueHigh: 1_000 });
    expect(evaluatePriceWatch(inverted, 1_200).isActive).toBe(false);
  });
});

describe("evaluatePriceWatch — gain_loss_pct", () => {
  // Added at $100.00; watching for a 20% swing either way.
  const watching = item({ watchKind: "gain_loss_pct", watchValue: 20 });

  it("fires on a gain of the threshold", () => {
    const result = evaluatePriceWatch(watching, 12_000);
    expect(result.isActive).toBe(true);
    expect(result.message).toContain("gained");
    expect(result.message).toContain("20.0%");
  });

  it("fires on a loss of the threshold — the swing is symmetric", () => {
    const result = evaluatePriceWatch(watching, 8_000);
    expect(result.isActive).toBe(true);
    expect(result.message).toContain("lost");
  });

  it("stays quiet inside the threshold", () => {
    expect(evaluatePriceWatch(watching, 11_900).isActive).toBe(false);
    expect(evaluatePriceWatch(watching, 8_100).isActive).toBe(false);
  });

  it("is inert with no baseline price to measure against", () => {
    // The quote failed when the row was added. Treating 0 as the baseline would
    // report every price as an infinite gain.
    const noBaseline = item({
      watchKind: "gain_loss_pct",
      watchValue: 20,
      priceWhenAddedCents: 0,
    });
    expect(evaluatePriceWatch(noBaseline, 12_000).isActive).toBe(false);
  });
});

describe("evaluatePriceWatch — gain_loss_price", () => {
  // Added at $100.00; watching for a $10.00 per-share swing either way.
  const watching = item({ watchKind: "gain_loss_price", watchValue: 1_000 });

  it("fires on a rise of the threshold", () => {
    const result = evaluatePriceWatch(watching, 11_000);
    expect(result.isActive).toBe(true);
    expect(result.message).toContain("gained");
    expect(result.message).toContain("$10.00");
  });

  it("fires on a fall of the threshold", () => {
    expect(evaluatePriceWatch(watching, 9_000).message).toContain("lost");
  });

  it("stays quiet inside the threshold", () => {
    expect(evaluatePriceWatch(watching, 10_999).isActive).toBe(false);
  });
});

describe("evaluatePriceWatch — kinds it does not judge", () => {
  it("is quiet for an unwatched row", () => {
    expect(evaluatePriceWatch(item({ watchKind: "" }), 10_000).isActive).toBe(false);
  });

  it("is quiet for the event kinds, which are judged against dates", () => {
    expect(evaluatePriceWatch(item({ watchKind: "dividend" }), 10_000).isActive).toBe(false);
    expect(evaluatePriceWatch(item({ watchKind: "split" }), 10_000).isActive).toBe(false);
  });
});

describe("evaluateEventWatch", () => {
  const dividend = (date: string, amountCents?: number): MarketEvent => ({
    timestamp: at(date),
    kind: "dividend",
    amountCents,
  });

  it("fires on a dividend dated after the row was added", () => {
    const watching = item({ watchKind: "dividend", addedDate: "2026-01-01" });
    const result = evaluateEventWatch(watching, [dividend("2026-02-01", 25)]);

    expect(result.isActive).toBe(true);
    expect(result.shouldNotify).toBe(true);
    expect(result.eventDate).toBe("2026-02-01");
    expect(result.message).toContain("$0.25");
  });

  it("ignores a dividend that predates the row — not news", () => {
    // Adding a ticker to a watch list must not immediately announce last
    // quarter's dividend as though it had just happened.
    const watching = item({ watchKind: "dividend", addedDate: "2026-01-01" });
    expect(evaluateEventWatch(watching, [dividend("2025-12-01", 25)]).isActive).toBe(false);
  });

  it("ignores an event at or before the cursor, and fires on the next one", () => {
    const reported = item({
      watchKind: "dividend",
      addedDate: "2026-01-01",
      watchLastTriggeredAt: "2026-02-01",
      watchIsTriggered: true,
    });

    // The one already reported is behind the cursor.
    expect(evaluateEventWatch(reported, [dividend("2026-02-01", 25)]).isActive).toBe(false);

    // Next quarter's is ahead of it, and fires despite the latch being set —
    // which is the whole reason the event kinds use a cursor rather than a band.
    const next = evaluateEventWatch(reported, [dividend("2026-02-01", 25), dividend("2026-05-01", 25)]);
    expect(next.shouldNotify).toBe(true);
    expect(next.eventDate).toBe("2026-05-01");
  });

  it("reports the newest event when several are fresh", () => {
    const watching = item({ watchKind: "dividend", addedDate: "2026-01-01" });
    const result = evaluateEventWatch(watching, [
      dividend("2026-02-01", 25),
      dividend("2026-05-01", 30),
    ]);
    expect(result.eventDate).toBe("2026-05-01");
  });

  it("ignores events of the other kind", () => {
    const watching = item({ watchKind: "split", addedDate: "2026-01-01" });
    expect(evaluateEventWatch(watching, [dividend("2026-02-01", 25)]).isActive).toBe(false);

    const split = evaluateEventWatch(watching, [
      { timestamp: at("2026-03-01"), kind: "split", ratio: "4:1" },
    ]);
    expect(split.isActive).toBe(true);
    expect(split.message).toContain("4:1");
  });

  it("is quiet with no events at all", () => {
    const watching = item({ watchKind: "dividend" });
    expect(evaluateEventWatch(watching, []).isActive).toBe(false);
  });
});

describe("priceSwing", () => {
  it("is signed, and relative to the price when added", () => {
    expect(priceSwing(item(), 12_000)).toEqual({ deltaCents: 2_000, deltaPct: 20 });
    expect(priceSwing(item(), 8_000)).toEqual({ deltaCents: -2_000, deltaPct: -20 });
  });

  it("has no answer without a baseline", () => {
    expect(priceSwing(item({ priceWhenAddedCents: 0 }), 12_000)).toBeUndefined();
  });
});

describe("eventDateIso", () => {
  it("renders epoch seconds as the YYYY-MM-DD the module stores", () => {
    expect(eventDateIso(at("2026-05-01"))).toBe("2026-05-01");
  });
});

describe("summarizeWatch", () => {
  it("describes each kind without needing a live price", () => {
    expect(summarizeWatch({ watchKind: "", watchValue: 0, watchValueHigh: 0 })).toBe("—");
    expect(summarizeWatch({ watchKind: "price", watchValue: 10_000, watchValueHigh: 0 })).toBe(
      "Price hits $100.00",
    );
    expect(
      summarizeWatch({ watchKind: "price_range", watchValue: 1_000, watchValueHigh: 1_500 }),
    ).toBe("Price within $10.00–$15.00");
    expect(summarizeWatch({ watchKind: "dividend", watchValue: 0, watchValueHigh: 0 })).toBe(
      "Dividend issued",
    );
    expect(summarizeWatch({ watchKind: "split", watchValue: 0, watchValueHigh: 0 })).toBe(
      "Split happens",
    );
    expect(summarizeWatch({ watchKind: "gain_loss_pct", watchValue: 20, watchValueHigh: 0 })).toBe(
      "Gain/loss of 20%",
    );
    expect(
      summarizeWatch({ watchKind: "gain_loss_price", watchValue: 1_000, watchValueHigh: 0 }),
    ).toBe("Gain/loss of $10.00 per share");
  });
});
