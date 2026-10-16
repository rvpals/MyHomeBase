import { describe, expect, it } from "vitest";
import { FakeMessageRepository } from "@/lib/messages";
import { FakePositionReader, FakeTickerMonitorRepository, makeMonitor } from "./fakes";
import {
  activeWarningsForTicker,
  createMonitor,
  deleteMonitor,
  listMonitorsForTicker,
  runMonitors,
  setMonitorEnabled,
  updateMonitor,
  valuationForTicker,
} from "./ticker-monitors";

const TEN_K = 1_000_000;

/** NVDA: $9,900 unrealized gain on a $50,000 basis — inside a $10,000 target's band. */
function nearTargetPositions() {
  return new FakePositionReader({
    NVDA: [{ unrealizedGainLossCents: 990_000, costCents: 5_000_000 }],
  });
}

describe("createMonitor", () => {
  it("stores a gain monitor and defaults the band", () => {
    const repo = new FakeTickerMonitorRepository();

    const monitor = createMonitor(repo, {
      ticker: "nvda",
      monitorType: "gain_near_amount",
      targetCents: TEN_K,
    });

    // Uppercased by the schema, like every other ticker in the module.
    expect(monitor.ticker).toBe("NVDA");
    expect(monitor.bandPct).toBe(5);
    expect(monitor.isEnabled).toBe(true);
    expect(monitor.isTriggered).toBe(false);
  });

  it("refuses a gain monitor with no target — that is a forgotten field", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "gain_near_amount",
        targetCents: 0,
      }),
    ).toThrow();
    expect(repo.monitors).toHaveLength(0);
  });

  it("allows a zero target on a loss monitor — break-even is the useful case", () => {
    const repo = new FakeTickerMonitorRepository();

    const monitor = createMonitor(repo, {
      ticker: "INTC",
      monitorType: "loss_near_amount",
      targetCents: 0,
    });

    expect(monitor.targetCents).toBe(0);
  });

  it("refuses a percent monitor with no percentage", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "gain_near_pct_of_cost",
        targetPct: 0,
      }),
    ).toThrow();
  });

  it("refuses a band of 0% — it could never match", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "gain_near_amount",
        targetCents: TEN_K,
        bandPct: 0,
      }),
    ).toThrow();
  });

  it("refuses a negative target amount", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "loss_near_amount",
        targetCents: -200_000,
      }),
    ).toThrow();
  });

  it("refuses an unknown monitor type", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "price_near",
        targetCents: TEN_K,
      } as never),
    ).toThrow();
  });
});

describe("listMonitorsForTicker", () => {
  it("returns only that ticker's monitors", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, ticker: "NVDA" }),
      makeMonitor({ id: 2, ticker: "AMD" }),
    ]);

    expect(listMonitorsForTicker(repo, "NVDA").map((m) => m.id)).toEqual([1]);
  });

  it("matches case-insensitively, since the schema uppercases", () => {
    const repo = new FakeTickerMonitorRepository([makeMonitor({ id: 1, ticker: "NVDA" })]);

    expect(listMonitorsForTicker(repo, "nvda")).toHaveLength(1);
  });
});

describe("updateMonitor", () => {
  it("re-arms the latch, so a new target's first crossing still reports", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, isTriggered: true, targetCents: TEN_K }),
    ]);

    const updated = updateMonitor(repo, {
      id: 1,
      ticker: "NVDA",
      monitorType: "gain_near_amount",
      targetCents: 2_000_000,
      targetPct: 0,
      bandPct: 5,
      isEnabled: true,
    });

    expect(updated.targetCents).toBe(2_000_000);
    expect(updated.isTriggered).toBe(false);
  });

  it("throws on an id that does not exist", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      updateMonitor(repo, {
        id: 99,
        ticker: "NVDA",
        monitorType: "gain_near_amount",
        targetCents: TEN_K,
        targetPct: 0,
        bandPct: 5,
        isEnabled: true,
      }),
    ).toThrow();
  });
});

describe("setMonitorEnabled / deleteMonitor", () => {
  it("disables without deleting, keeping the row's history", () => {
    const repo = new FakeTickerMonitorRepository([makeMonitor({ id: 1 })]);

    setMonitorEnabled(repo, 1, false);

    expect(repo.getById(1)?.isEnabled).toBe(false);
    expect(repo.monitors).toHaveLength(1);
  });

  it("deletes", () => {
    const repo = new FakeTickerMonitorRepository([makeMonitor({ id: 1 })]);

    deleteMonitor(repo, 1);

    expect(repo.monitors).toHaveLength(0);
  });

  it("rejects a non-positive id", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() => deleteMonitor(repo, 0)).toThrow();
  });
});

describe("valuationForTicker", () => {
  it("sums the ticker across accounts", () => {
    const positions = new FakePositionReader({
      NVDA: [
        { unrealizedGainLossCents: 300_000, costCents: 1_000_000 },
        { unrealizedGainLossCents: 200_000, costCents: 2_000_000 },
      ],
    });

    expect(valuationForTicker(positions, "NVDA").unrealizedGainLossCents).toBe(500_000);
  });

  it("is zeroed for a ticker that is not held", () => {
    expect(valuationForTicker(new FakePositionReader(), "TSLA").costCents).toBe(0);
  });
});

describe("runMonitors", () => {
  it("files one message and latches when a monitor newly fires", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, nearTargetPositions(), messages);

    expect(result).toMatchObject({ evaluated: 1, triggered: 1, triggeredTickers: ["NVDA"] });
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0].title).toBe("NVDA: monitor triggered");
    expect(messages.messages[0].source).toBe("Investments monitor");
    // Stamped by the producer, never by the caller -- a monitor cannot file a
    // message attributed to another module.
    expect(messages.messages[0].module).toBe("investments");
    expect(repo.getById(1)?.isTriggered).toBe(true);
    expect(repo.getById(1)?.lastMessage).toContain("$9,900.00");
  });

  it("files nothing on a second run while the condition still holds", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K }),
    ]);
    const messages = new FakeMessageRepository();
    const positions = nearTargetPositions();

    runMonitors(repo, positions, messages);
    const second = runMonitors(repo, positions, messages);

    // This is the whole point of the latch: refreshing hourly must not fill the
    // queue with forty copies of one sentence.
    expect(second.triggered).toBe(0);
    expect(messages.messages).toHaveLength(1);
  });

  it("re-arms when the value leaves the band, and fires again when it returns", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K }),
    ]);
    const messages = new FakeMessageRepository();

    runMonitors(repo, nearTargetPositions(), messages);

    // Gain collapses well below the band.
    const away = new FakePositionReader({
      NVDA: [{ unrealizedGainLossCents: 100_000, costCents: 5_000_000 }],
    });
    const cleared = runMonitors(repo, away, messages);
    expect(cleared.cleared).toBe(1);
    expect(repo.getById(1)?.isTriggered).toBe(false);

    // Back into the band — a genuinely new crossing, so it reports again.
    const again = runMonitors(repo, nearTargetPositions(), messages);
    expect(again.triggered).toBe(1);
    expect(messages.messages).toHaveLength(2);
  });

  it("skips disabled monitors entirely", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K, isEnabled: false }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, nearTargetPositions(), messages);

    expect(result.evaluated).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });

  it("files nothing for a ticker that is no longer held", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, ticker: "TSLA", targetCents: TEN_K }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, new FakePositionReader(), messages);

    expect(result.triggered).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });

  it("evaluates two monitors on one ticker against the same figures", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K }),
      // 20% of the $50,000 basis is also $10,000, so both are in band.
      makeMonitor({ id: 2, monitorType: "gain_near_pct_of_cost", targetCents: 0, targetPct: 20 }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, nearTargetPositions(), messages);

    expect(result.evaluated).toBe(2);
    expect(result.triggered).toBe(2);
    // One ticker, listed once, even though two monitors fired.
    expect(result.triggeredTickers).toEqual(["NVDA"]);
  });

  it("does nothing at all when no monitors are set", () => {
    const messages = new FakeMessageRepository();

    const result = runMonitors(
      new FakeTickerMonitorRepository(),
      nearTargetPositions(),
      messages,
    );

    expect(result).toEqual({ evaluated: 0, triggered: 0, cleared: 0, triggeredTickers: [] });
  });
});

describe("activeWarningsForTicker", () => {
  it("reports a condition that is true now, without filing or latching", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K }),
    ]);

    const warnings = activeWarningsForTicker(repo, nearTargetPositions(), "NVDA");

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("NVDA");
    // Read-only: safe to call on every render, which is what the icon needs.
    expect(repo.getById(1)?.isTriggered).toBe(false);
  });

  it("still reports while the latch is set — the icon tracks 'now', not 'new'", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: TEN_K, isTriggered: true }),
    ]);

    expect(activeWarningsForTicker(repo, nearTargetPositions(), "NVDA")).toHaveLength(1);
  });

  it("reports nothing when no condition holds", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, targetCents: 9_000_000 }),
    ]);

    expect(activeWarningsForTicker(repo, nearTargetPositions(), "NVDA")).toEqual([]);
  });
});

/**
 * BMY: 100 shares at $38.42, down $1.15 a share today, no recorded basis.
 *
 * The screenshot's holding, and deliberately basis-free: it is the case the
 * price types exist for, and the one every 0110 monitor refuses to judge.
 */
function bmyPositions() {
  return new FakePositionReader({
    BMY: [
      {
        unrealizedGainLossCents: 0,
        costCents: 0,
        currentPriceCents: 3_842,
        quantity: 100,
        // (38.42 - 39.57) * 100 shares, in cents.
        dayGainLossCents: -11_500,
      },
    ],
  });
}

describe("createMonitor - the price and day-move types", () => {
  it("stores a price target", () => {
    const repo = new FakeTickerMonitorRepository();

    const monitor = createMonitor(repo, {
      ticker: "bmy",
      monitorType: "price_near_amount",
      targetCents: 4_500,
      bandPct: 1,
    });

    expect(monitor.ticker).toBe("BMY");
    expect(monitor.targetCents).toBe(4_500);
    expect(monitor.bandPct).toBe(1);
    // Not a directional type, so the column holds its sentinel.
    expect(monitor.direction).toBe("");
  });

  it("refuses a price target of zero - a forgotten field", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "BMY",
        monitorType: "price_near_amount",
        targetCents: 0,
      }),
    ).toThrow();
    expect(repo.monitors).toHaveLength(0);
  });

  it("stores a day-move monitor with its direction", () => {
    const repo = new FakeTickerMonitorRepository();

    const monitor = createMonitor(repo, {
      ticker: "BMY",
      monitorType: "day_move_pct",
      targetPct: 3,
      direction: "down",
    });

    expect(monitor.targetPct).toBe(3);
    expect(monitor.direction).toBe("down");
  });

  it("refuses a day-move monitor with no direction", () => {
    // Defaulting to "up" would store the opposite of what someone who meant
    // "down" and forgot the flag asked for.
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "BMY",
        monitorType: "day_move_pct",
        targetPct: 3,
      }),
    ).toThrow();
    expect(repo.monitors).toHaveLength(0);
  });

  it("refuses a day-move monitor with no move size", () => {
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "BMY",
        monitorType: "day_move_pct",
        targetPct: 0,
        direction: "up",
      }),
    ).toThrow();
  });

  it("refuses a direction on a type that does not read one", () => {
    // Storing it would leave a row whose column disagrees with how it is read.
    const repo = new FakeTickerMonitorRepository();

    expect(() =>
      createMonitor(repo, {
        ticker: "NVDA",
        monitorType: "gain_near_amount",
        targetCents: TEN_K,
        direction: "up",
      }),
    ).toThrow();
  });
});

describe("runMonitors - the price types on a holding with no basis", () => {
  it("fires a price monitor and files a message", () => {
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({
        id: 1,
        ticker: "BMY",
        monitorType: "price_near_amount",
        // $38.50, with the price at $38.42 - inside a 1% band.
        targetCents: 3_850,
        bandPct: 1,
      }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, bmyPositions(), messages);

    expect(result.triggered).toBe(1);
    expect(result.triggeredTickers).toEqual(["BMY"]);
    expect(repo.getById(1)?.isTriggered).toBe(true);
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0].body).toContain("$38.42");
  });

  it("fires a down-move monitor on the day's drop", () => {
    // -1.15 against a 39.57 close is about -2.91%, so a 2% threshold is met
    // and a 3% one is not.
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({
        id: 1,
        ticker: "BMY",
        monitorType: "day_move_pct",
        targetCents: 0,
        targetPct: 2,
        direction: "down",
      }),
      makeMonitor({
        id: 2,
        ticker: "BMY",
        monitorType: "day_move_pct",
        targetCents: 0,
        targetPct: 3,
        direction: "down",
      }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, bmyPositions(), messages);

    expect(result.evaluated).toBe(2);
    expect(result.triggered).toBe(1);
    expect(repo.getById(1)?.isTriggered).toBe(true);
    expect(repo.getById(2)?.isTriggered).toBe(false);
  });

  it("still refuses a gain monitor on the same basis-free holding", () => {
    // The guard became per-type, not absent: this is the half that must not
    // have changed.
    const repo = new FakeTickerMonitorRepository([
      makeMonitor({ id: 1, ticker: "BMY", targetCents: TEN_K }),
    ]);
    const messages = new FakeMessageRepository();

    const result = runMonitors(repo, bmyPositions(), messages);

    expect(result.triggered).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });
});

describe("valuationForTicker - the price figures", () => {
  it("reports the price and today's move", () => {
    const valuation = valuationForTicker(bmyPositions(), "bmy");

    expect(valuation.ticker).toBe("BMY");
    expect(valuation.pricePerShareCents).toBe(3_842);
    expect(valuation.previousClosePerShareCents).toBe(3_957);
    expect(valuation.dayChangePct).toBeCloseTo(-2.906, 2);
  });
});
