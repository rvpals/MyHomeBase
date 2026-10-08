import { describe, expect, it } from "vitest";
import type { HomeWidgetId } from "@/lib/home-dashboard";
import {
  applyPersonalOrder,
  defaultHomeLayout,
  homeWidgetOrderToValue,
  moveHomeWidgetInOrder,
  reorderHomeWidgets,
  resolveHomeColumns,
  resolveHomeWidgetOrder,
} from "./home-layout";

describe("defaultHomeLayout", () => {
  it("ships as one column with no personal opinion", () => {
    expect(defaultHomeLayout()).toEqual({ columns: 1, order: [], hidden: [] });
  });
});

describe("resolveHomeColumns", () => {
  it("reads a stored count", () => {
    expect(resolveHomeColumns("2")).toBe(2);
    expect(resolveHomeColumns("1")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveHomeColumns(" 2 ")).toBe(2);
  });

  it("falls back to the default when unset", () => {
    expect(resolveHomeColumns(undefined)).toBe(1);
    expect(resolveHomeColumns("")).toBe(1);
    expect(resolveHomeColumns("   ")).toBe(1);
  });

  // The failure path that matters: the home screen has to render, so a garbled
  // value must resolve rather than throw.
  it("corrects an unsupported or unparseable count to the default", () => {
    expect(resolveHomeColumns("3")).toBe(1);
    expect(resolveHomeColumns("0")).toBe(1);
    expect(resolveHomeColumns("-2")).toBe(1);
    expect(resolveHomeColumns("1.5")).toBe(1);
    expect(resolveHomeColumns("two")).toBe(1);
  });
});

describe("resolveHomeWidgetOrder", () => {
  it("reads a stored order", () => {
    expect(resolveHomeWidgetOrder("dailyQuote,carousel,stockGlance")).toEqual([
      "dailyQuote",
      "carousel",
      "stockGlance",
    ]);
  });

  it("resolves an unset value to no opinion rather than to the catalogue", () => {
    expect(resolveHomeWidgetOrder(undefined)).toEqual([]);
    expect(resolveHomeWidgetOrder("")).toEqual([]);
  });

  it("drops an id that is no longer a card", () => {
    // `clock` was retired from the catalogue; a layout naming it still resolves.
    expect(resolveHomeWidgetOrder("dailyQuote,clock,carousel")).toEqual([
      "dailyQuote",
      "carousel",
    ]);
  });

  it("drops a duplicate rather than drawing a card twice", () => {
    expect(resolveHomeWidgetOrder("dailyQuote,carousel,dailyQuote")).toEqual([
      "dailyQuote",
      "carousel",
    ]);
  });

  it("ignores blank tokens and stray whitespace", () => {
    expect(resolveHomeWidgetOrder(" dailyQuote , , carousel ")).toEqual([
      "dailyQuote",
      "carousel",
    ]);
  });
});

describe("homeWidgetOrderToValue", () => {
  it("round-trips through the resolver", () => {
    const order: HomeWidgetId[] = ["stockGlance", "dailyQuote", "carousel"];
    expect(resolveHomeWidgetOrder(homeWidgetOrderToValue(order))).toEqual(order);
  });

  it("writes no opinion as an empty string", () => {
    expect(homeWidgetOrderToValue([])).toBe("");
  });

  it("rejects a duplicate rather than storing it", () => {
    expect(() => homeWidgetOrderToValue(["dailyQuote", "dailyQuote"])).toThrow();
  });
});

describe("applyPersonalOrder", () => {
  const visible: HomeWidgetId[] = ["carousel", "dailyQuote", "todayInHistory"];

  it("leaves the household order alone when the reader has no opinion", () => {
    expect(applyPersonalOrder(visible, [])).toEqual(visible);
  });

  it("applies the reader's arrangement", () => {
    expect(applyPersonalOrder(visible, ["todayInHistory", "carousel", "dailyQuote"])).toEqual([
      "todayInHistory",
      "carousel",
      "dailyQuote",
    ]);
  });

  it("skips a card the reader arranged but that isn't drawn today", () => {
    // Arranged while holding positions; today the Stock card has nothing to say.
    expect(
      applyPersonalOrder(visible, ["stockGlance", "todayInHistory", "carousel", "dailyQuote"]),
    ).toEqual(["todayInHistory", "carousel", "dailyQuote"]);
  });

  it("appends a visible card the personal order doesn't name", () => {
    // The case a newly-shipped card lands in: it goes at the end of a hand-made
    // layout rather than into the middle of it.
    expect(applyPersonalOrder(visible, ["todayInHistory", "carousel"])).toEqual([
      "todayInHistory",
      "carousel",
      "dailyQuote",
    ]);
  });

  it("cannot add a card that isn't visible", () => {
    expect(applyPersonalOrder(["carousel"], ["dailyQuote", "carousel"])).toEqual(["carousel"]);
  });
});

describe("reorderHomeWidgets", () => {
  const order: HomeWidgetId[] = ["carousel", "dailyQuote", "todayInHistory", "stockGlance"];

  it("moves a card down onto its target's position", () => {
    expect(reorderHomeWidgets(order, "carousel", "todayInHistory")).toEqual([
      "dailyQuote",
      "todayInHistory",
      "carousel",
      "stockGlance",
    ]);
  });

  it("moves a card up onto its target's position", () => {
    expect(reorderHomeWidgets(order, "stockGlance", "dailyQuote")).toEqual([
      "carousel",
      "stockGlance",
      "dailyQuote",
      "todayInHistory",
    ]);
  });

  it("treats a drop onto itself as a no-op, not an error", () => {
    expect(reorderHomeWidgets(order, "dailyQuote", "dailyQuote")).toEqual(order);
  });

  it("returns the list unchanged when either card is absent", () => {
    expect(reorderHomeWidgets(order, "myShortcuts", "dailyQuote")).toEqual(order);
    expect(reorderHomeWidgets(order, "dailyQuote", "myShortcuts")).toEqual(order);
  });

  it("does not mutate the list it was given", () => {
    const original: HomeWidgetId[] = [...order];
    reorderHomeWidgets(original, "carousel", "stockGlance");
    expect(original).toEqual(order);
  });
});

describe("moveHomeWidgetInOrder", () => {
  const order: HomeWidgetId[] = ["carousel", "dailyQuote", "todayInHistory"];

  it("swaps with the card above", () => {
    expect(moveHomeWidgetInOrder(order, "dailyQuote", "up")).toEqual([
      "dailyQuote",
      "carousel",
      "todayInHistory",
    ]);
  });

  it("swaps with the card below", () => {
    expect(moveHomeWidgetInOrder(order, "dailyQuote", "down")).toEqual([
      "carousel",
      "todayInHistory",
      "dailyQuote",
    ]);
  });

  it("refuses to wrap at either end", () => {
    expect(moveHomeWidgetInOrder(order, "carousel", "up")).toEqual(order);
    expect(moveHomeWidgetInOrder(order, "todayInHistory", "down")).toEqual(order);
  });

  it("returns the list unchanged for a card that isn't in it", () => {
    expect(moveHomeWidgetInOrder(order, "stockGlance", "up")).toEqual(order);
  });
});
