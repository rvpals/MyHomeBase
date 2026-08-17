import { describe, expect, it } from "vitest";
import {
  CANDLE_BODY_RATIO,
  MIN_BODY_WIDTH,
  candleDomain,
  candleGeometry,
  hasFullBars,
  normalizeCandleBar,
  type CandleBar,
} from "./chart-candle";

/** A well-formed up bar: opened 100, ranged 95–112, closed 110. */
const UP: CandleBar = { x: "2026-08-10", openCents: 10000, highCents: 11200, lowCents: 9500, closeCents: 11000 };
const DOWN: CandleBar = { x: "2026-08-11", openCents: 11000, highCents: 11100, lowCents: 10200, closeCents: 10300 };

/** Cents map to pixels inverted, the way an SVG y-axis runs: higher price, smaller y. */
const toY = (cents: number) => 1000 - cents / 100;

describe("hasFullBars", () => {
  it("accepts a series where every point carries a full bar", () => {
    expect(hasFullBars([UP, DOWN])).toBe(true);
  });

  it("rejects a series where any point is missing part of its bar", () => {
    expect(hasFullBars([UP, { closeCents: 10300 }])).toBe(false);
    expect(hasFullBars([{ closeCents: 10300, openCents: 10000, highCents: 10500 }])).toBe(false);
  });

  it("rejects an empty series — there is nothing to draw", () => {
    expect(hasFullBars([])).toBe(false);
  });

  it("rejects non-positive and non-finite prices as the provider's 'no print'", () => {
    expect(hasFullBars([{ ...UP, lowCents: 0 }])).toBe(false);
    expect(hasFullBars([{ ...UP, openCents: -100 }])).toBe(false);
    expect(hasFullBars([{ ...UP, highCents: Number.NaN }])).toBe(false);
  });
});

describe("normalizeCandleBar", () => {
  it("reads direction and change from open against close", () => {
    expect(normalizeCandleBar(UP).direction).toBe("up");
    expect(normalizeCandleBar(UP).changeCents).toBe(1000);
    expect(normalizeCandleBar(DOWN).direction).toBe("down");
    expect(normalizeCandleBar(DOWN).changeCents).toBe(-700);
  });

  it("calls a bar that closed where it opened flat", () => {
    const doji = normalizeCandleBar({ ...UP, openCents: 10000, closeCents: 10000 });
    expect(doji.direction).toBe("flat");
    expect(doji.changeCents).toBe(0);
  });

  it("leaves a well-formed bar's extremes alone", () => {
    const bar = normalizeCandleBar(UP);
    expect(bar.highCents).toBe(11200);
    expect(bar.lowCents).toBe(9500);
  });

  it("widens a high the provider reported below the body, so no wick draws inside it", () => {
    // Yahoo does this on thin volume: a high fractionally under the close.
    const bar = normalizeCandleBar({ ...UP, highCents: 10900 });
    expect(bar.highCents).toBe(11000);
  });

  it("widens a low the provider reported above the body", () => {
    const bar = normalizeCandleBar({ ...UP, lowCents: 10500 });
    expect(bar.lowCents).toBe(10000);
  });
});

describe("candleDomain", () => {
  it("spans the wicks, not the closes, with padding clear of the frame", () => {
    const [low, high] = candleDomain([UP, DOWN].map(normalizeCandleBar));
    // Wick range is 9500..11200, span 1700, so 85 cents of padding either side.
    expect(low).toBeCloseTo(9415);
    expect(high).toBeCloseTo(11285);
  });

  it("gives a flat series a band rather than a zero-height domain", () => {
    const flat = normalizeCandleBar({ x: "d", openCents: 5000, highCents: 5000, lowCents: 5000, closeCents: 5000 });
    const [low, high] = candleDomain([flat]);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeCloseTo(4750);
    expect(high).toBeCloseTo(5250);
  });

  it("falls back to a nominal domain for an empty series", () => {
    expect(candleDomain([])).toEqual([0, 1]);
  });

  it("handles a single bar", () => {
    const [low, high] = candleDomain([normalizeCandleBar(UP)]);
    expect(low).toBeLessThan(9500);
    expect(high).toBeGreaterThan(11200);
  });
});

describe("candleGeometry", () => {
  const slot = { x: 100, width: 20 };

  it("centres body and wick on the slot", () => {
    const geometry = candleGeometry(normalizeCandleBar(UP), slot, toY);
    expect(geometry.wickX).toBe(110);
    expect(geometry.bodyWidth).toBeCloseTo(20 * CANDLE_BODY_RATIO);
    expect(geometry.bodyX).toBeCloseTo(110 - (20 * CANDLE_BODY_RATIO) / 2);
  });

  it("spans the body from open to close, whichever is on top", () => {
    const up = candleGeometry(normalizeCandleBar(UP), slot, toY);
    const down = candleGeometry(normalizeCandleBar(DOWN), slot, toY);
    // Up closed higher, so its body top is the close; down's is the open.
    expect(up.bodyY).toBeCloseTo(toY(11000));
    expect(down.bodyY).toBeCloseTo(toY(11000));
    expect(up.bodyHeight).toBeCloseTo(10);
    expect(down.bodyHeight).toBeCloseTo(7);
  });

  it("runs the wick from high to low", () => {
    const geometry = candleGeometry(normalizeCandleBar(UP), slot, toY);
    expect(geometry.wickTop).toBeCloseTo(toY(11200));
    expect(geometry.wickBottom).toBeCloseTo(toY(9500));
  });

  it("floors a doji's body so it stays visible", () => {
    const doji = normalizeCandleBar({ ...UP, openCents: 10000, closeCents: 10000 });
    expect(candleGeometry(doji, slot, toY).bodyHeight).toBe(1);
    expect(candleGeometry(doji, slot, toY, 2).bodyHeight).toBe(2);
  });

  it("drops the body when the slot is too narrow to read as a rectangle", () => {
    const wide = candleGeometry(normalizeCandleBar(UP), { x: 0, width: 20 }, toY);
    const thin = candleGeometry(normalizeCandleBar(UP), { x: 0, width: 2 }, toY);
    expect(wide.showBody).toBe(true);
    expect(thin.showBody).toBe(false);
  });

  it("keeps a body at least a pixel wide even in a hairline slot", () => {
    const geometry = candleGeometry(normalizeCandleBar(UP), { x: 0, width: 0.5 }, toY);
    expect(geometry.bodyWidth).toBe(1);
    expect(geometry.bodyWidth).toBeLessThan(MIN_BODY_WIDTH);
  });
});
