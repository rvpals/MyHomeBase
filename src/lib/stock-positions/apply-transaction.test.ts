import { describe, expect, it } from "vitest";
import {
  applyTransactionToPosition,
  describeMatchFailure,
  describeProjectedHolding,
  OversellError,
  resolveTargetPosition,
} from "./apply-transaction";
import type { StockPosition } from "./types";

/** Same defaulted fixture as stock-positions.test.ts — state only what matters. */
function makePosition(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 0,
    ticker: "BMY",
    name: "Bristol-Myers Squibb",
    type: "Stock",
    currentPriceCents: 5000,
    quantity: 20,
    dayGainLossCents: 0,
    valueCents: 100000,
    dayHighCents: 0,
    dayLowCents: 0,
    dividendRateCents: 0,
    costCents: 80000,
    unitCostCents: 4000,
    unrealizedGainLossCents: 20000,
    unrealizedGainLossPct: 25,
    cusip: "",
    isin: "",
    assetClass: "",
    assetStrategy: "",
    estAnnualIncomeCents: 0,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveTargetPosition", () => {
  it("matches the single account holding the ticker", () => {
    const match = resolveTargetPosition([makePosition({ accountId: 3 })], "BMY");
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.position.accountId).toBe(3);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    const match = resolveTargetPosition([makePosition()], "  bmy ");
    expect(match.ok).toBe(true);
  });

  it("fails with 'none' when no position holds the ticker", () => {
    const match = resolveTargetPosition([makePosition({ ticker: "AAPL" })], "BMY");
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.failure.kind).toBe("none");
  });

  it("refuses to guess when two accounts hold the ticker", () => {
    const match = resolveTargetPosition(
      [makePosition({ accountId: 1 }), makePosition({ accountId: 2 })],
      "BMY",
    );
    expect(match.ok).toBe(false);
    if (!match.ok && match.failure.kind === "ambiguous")
      expect(match.failure.candidates).toHaveLength(2);
    else expect.fail("expected an ambiguous failure");
  });

  it("uses the given account when the ticker is held more than once", () => {
    const match = resolveTargetPosition(
      [makePosition({ accountId: 1 }), makePosition({ accountId: 2 })],
      "BMY",
      2,
    );
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.position.accountId).toBe(2);
  });

  it("fails as 'wrong-account' when the named account doesn't hold it", () => {
    const match = resolveTargetPosition([makePosition({ accountId: 1 })], "BMY", 9);
    expect(match.ok).toBe(false);
    if (!match.ok && match.failure.kind === "wrong-account") {
      expect(match.failure.requestedAccountId).toBe(9);
      expect(match.failure.held.map((position) => position.accountId)).toEqual([1]);
    } else expect.fail("expected a wrong-account failure");
  });

  // The regression this column exists for: hold BMY in Chase (1) only, buy BMY at
  // Fidelity (2). The lone Chase holding used to be assumed to be the target, so the
  // Fidelity shares landed on the Chase position with no warning.
  it("does not fall back to the only holding when the trade names another account", () => {
    const chaseOnly = [makePosition({ accountId: 1, quantity: 100 })];
    const match = resolveTargetPosition(chaseOnly, "BMY", 2);
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.failure.kind).toBe("wrong-account");
  });

  it("treats Unassigned (0) as a real account rather than 'no account given'", () => {
    const match = resolveTargetPosition([makePosition({ accountId: 5 })], "BMY", 0);
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.failure.kind).toBe("wrong-account");
  });

  it("still matches when the trade's account is the one that holds it", () => {
    const match = resolveTargetPosition(
      [makePosition({ accountId: 1 }), makePosition({ accountId: 2 })],
      "BMY",
      1,
    );
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.position.accountId).toBe(1);
  });

  it("names both accounts when explaining a wrong-account failure", () => {
    const message = describeMatchFailure(
      {
        kind: "wrong-account",
        ticker: "BMY",
        requestedAccountId: 2,
        held: [makePosition({ accountId: 1 })],
      },
      (id) => (id === 1 ? "Chase" : "Fidelity"),
    );
    expect(message).toContain("held in Chase");
    expect(message).toContain("not in Fidelity");
  });

  it("names the ticker and the account count when explaining a failure", () => {
    const message = describeMatchFailure({
      kind: "ambiguous",
      ticker: "BMY",
      candidates: [makePosition({ accountId: 1 }), makePosition({ accountId: 2 })],
    });
    expect(message).toContain("BMY");
    expect(message).toContain("2 accounts");
  });
});

describe("describeProjectedHolding", () => {
  it("signs a buy with + and totals the result", () => {
    const message = describeProjectedHolding({
      ticker: "BMY",
      accountName: "Schwab Brokerage",
      currentQuantity: 100,
      delta: 25,
    });
    expect(message).toBe("BMY: 100 shares, now +25 = 125 shares (Schwab Brokerage).");
  });

  it("signs a sell with - and deducts", () => {
    const message = describeProjectedHolding({
      ticker: "BMY",
      accountName: "IRA",
      currentQuantity: 100,
      delta: -30,
    });
    expect(message).toBe("BMY: 100 shares, now -30 = 70 shares (IRA).");
  });

  it("shows a negative total for an oversell rather than clamping", () => {
    const message = describeProjectedHolding({
      ticker: "BMY",
      accountName: "IRA",
      currentQuantity: 10,
      delta: -25,
    });
    expect(message).toContain("= -15 shares");
  });

  it("trims trailing zeros off fractional shares", () => {
    const message = describeProjectedHolding({
      ticker: "VOO",
      accountName: "IRA",
      currentQuantity: 1.5,
      delta: 0.25,
    });
    expect(message).toBe("VOO: 1.5 shares, now +0.25 = 1.75 shares (IRA).");
  });
});

describe("applyTransactionToPosition", () => {
  it("deducts shares on a sell — the case this feature exists for", () => {
    const update = applyTransactionToPosition(makePosition({ quantity: 20 }), {
      action: "Sell",
      ticker: "BMY",
      numberOfShares: 5,
      pricePerShareCents: 5200,
    });
    expect(update.quantity).toBe(15);
  });

  it("adds shares on a buy", () => {
    const update = applyTransactionToPosition(makePosition({ quantity: 20 }), {
      action: "Buy",
      ticker: "BMY",
      numberOfShares: 5,
      pricePerShareCents: 5200,
    });
    expect(update.quantity).toBe(25);
  });

  it("re-averages the basis on a buy at a new price", () => {
    // 20 @ $40 = $800 basis, plus 20 @ $60 = $1200 → 40 shares, $2000, avg $50.
    const update = applyTransactionToPosition(
      makePosition({ quantity: 20, costCents: 80000, unitCostCents: 4000 }),
      { action: "Buy", ticker: "BMY", numberOfShares: 20, pricePerShareCents: 6000 },
    );
    expect(update.quantity).toBe(40);
    expect(update.costCents).toBe(200000);
    expect(update.unitCostCents).toBe(5000);
  });

  it("removes basis at average cost on a sell, leaving the average intact", () => {
    // Sells 5 of 20 @ $40 average: basis drops by $200, average stays $40.
    const update = applyTransactionToPosition(
      makePosition({ quantity: 20, costCents: 80000, unitCostCents: 4000 }),
      { action: "Sell", ticker: "BMY", numberOfShares: 5, pricePerShareCents: 9999 },
    );
    expect(update.costCents).toBe(60000);
    expect(update.unitCostCents).toBe(4000);
  });

  it("ignores the sell price when computing basis — it only affects realized gain", () => {
    const cheap = applyTransactionToPosition(makePosition(), {
      action: "Sell",
      ticker: "BMY",
      numberOfShares: 5,
      pricePerShareCents: 1,
    });
    const dear = applyTransactionToPosition(makePosition(), {
      action: "Sell",
      ticker: "BMY",
      numberOfShares: 5,
      pricePerShareCents: 999999,
    });
    expect(cheap.costCents).toBe(dear.costCents);
  });

  it("recomputes value and unrealized gain against the stored price", () => {
    const update = applyTransactionToPosition(
      makePosition({ quantity: 20, currentPriceCents: 5000, costCents: 80000, unitCostCents: 4000 }),
      { action: "Sell", ticker: "BMY", numberOfShares: 10, pricePerShareCents: 5000 },
    );
    // 10 left @ $50 = $500 value, against $400 remaining basis.
    expect(update.valueCents).toBe(50000);
    expect(update.costCents).toBe(40000);
    expect(update.unrealizedGainLossCents).toBe(10000);
    expect(update.unrealizedGainLossPct).toBeCloseTo(25);
  });

  it("keeps the position at zero shares when everything is sold", () => {
    const update = applyTransactionToPosition(makePosition({ quantity: 20 }), {
      action: "Sell",
      ticker: "BMY",
      numberOfShares: 20,
      pricePerShareCents: 5000,
    });
    expect(update.quantity).toBe(0);
    expect(update.valueCents).toBe(0);
    expect(update.costCents).toBe(0);
    // No basis and no shares means no gain to report, rather than a phantom loss.
    expect(update.unrealizedGainLossCents).toBe(0);
    expect(update.unrealizedGainLossPct).toBe(0);
  });

  it("rejects selling more than is held rather than going negative", () => {
    expect(() =>
      applyTransactionToPosition(makePosition({ quantity: 5 }), {
        action: "Sell",
        ticker: "BMY",
        numberOfShares: 6,
        pricePerShareCents: 5000,
      }),
    ).toThrow(OversellError);
  });

  it("says how many are held when refusing an oversell", () => {
    expect(() =>
      applyTransactionToPosition(makePosition({ quantity: 5 }), {
        action: "Sell",
        ticker: "BMY",
        numberOfShares: 6,
        pricePerShareCents: 5000,
      }),
    ).toThrow(/holds 5/);
  });

  it("reports no gain for a position with no known basis", () => {
    const update = applyTransactionToPosition(
      makePosition({ quantity: 20, costCents: 0, unitCostCents: 0 }),
      { action: "Sell", ticker: "BMY", numberOfShares: 5, pricePerShareCents: 5000 },
    );
    expect(update.quantity).toBe(15);
    expect(update.costCents).toBe(0);
    expect(update.unrealizedGainLossCents).toBe(0);
  });

  it("handles fractional shares without drifting off a cent", () => {
    const update = applyTransactionToPosition(
      makePosition({ quantity: 10.5, costCents: 42000, unitCostCents: 4000 }),
      { action: "Buy", ticker: "BMY", numberOfShares: 0.25, pricePerShareCents: 4400 },
    );
    expect(update.quantity).toBeCloseTo(10.75);
    expect(Number.isInteger(update.costCents)).toBe(true);
    expect(Number.isInteger(update.unitCostCents)).toBe(true);
    expect(Number.isInteger(update.valueCents)).toBe(true);
  });

  it("never leaves a negative basis when rounding overshoots", () => {
    // A rounded unit cost times the whole holding can exceed a rounded basis.
    const update = applyTransactionToPosition(
      makePosition({ quantity: 3, costCents: 100, unitCostCents: 33 }),
      { action: "Sell", ticker: "BMY", numberOfShares: 2, pricePerShareCents: 5000 },
    );
    expect(update.costCents).toBeGreaterThanOrEqual(0);
  });
});
