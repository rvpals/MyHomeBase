import { describe, expect, it } from "vitest";
import {
  defaultHomeWidgets,
  homeWidgetsToValue,
  isHomeWidgetVisible,
  moveHomeWidget,
  resolveHomeWidgets,
  toggleHomeWidget,
  visibleHomeWidgets,
} from "./home-dashboard";
import { homeWidgetsSchema } from "./schema";
import { HOME_WIDGET_IDS, HOME_WIDGET_INFO } from "./types";

describe("defaultHomeWidgets", () => {
  it("lists every card once, visible, in catalogue order", () => {
    const widgets = defaultHomeWidgets();
    expect(widgets.map((widget) => widget.id)).toEqual([...HOME_WIDGET_IDS]);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
  });

  it("has label and description copy for every card", () => {
    // The admin list renders both, so a card added to the catalogue without info would
    // render an empty row rather than throwing.
    for (const id of HOME_WIDGET_IDS) {
      expect(HOME_WIDGET_INFO[id]?.label, id).toBeTruthy();
      expect(HOME_WIDGET_INFO[id]?.description, id).toBeTruthy();
    }
  });
});

describe("resolveHomeWidgets", () => {
  it("falls back to the default for a missing, blank or whitespace value", () => {
    expect(resolveHomeWidgets(undefined)).toEqual(defaultHomeWidgets());
    expect(resolveHomeWidgets("")).toEqual(defaultHomeWidgets());
    expect(resolveHomeWidgets("   ")).toEqual(defaultHomeWidgets());
  });

  it("reads a stored order back", () => {
    const widgets = resolveHomeWidgets(
      "randomPhoto,carousel,dailyQuote,todayInHistory,stockGlance",
    );
    expect(widgets.map((widget) => widget.id)).toEqual([
      "randomPhoto",
      "carousel",
      "dailyQuote",
      "todayInHistory",
      "stockGlance",
    ]);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
  });

  it("reads a hyphen prefix as hidden", () => {
    const widgets = resolveHomeWidgets(
      "carousel,-dailyQuote,todayInHistory,randomPhoto,stockGlance",
    );
    expect(widgets.find((widget) => widget.id === "dailyQuote")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "carousel")?.visible).toBe(true);
  });

  it("drops an id that is no longer a card", () => {
    // A retired card must not leave a hole or throw.
    const widgets = resolveHomeWidgets("carousel,retiredCard,dailyQuote");
    expect(widgets.map((widget) => widget.id)).not.toContain("retiredCard");
    expect(widgets).toHaveLength(HOME_WIDGET_IDS.length);
  });

  it("ignores a duplicate rather than drawing a card twice", () => {
    const widgets = resolveHomeWidgets("carousel,carousel,dailyQuote");
    expect(widgets.filter((widget) => widget.id === "carousel")).toHaveLength(1);
    expect(widgets).toHaveLength(HOME_WIDGET_IDS.length);
  });

  it("falls back to the default when nothing in the value is a known card", () => {
    expect(resolveHomeWidgets("nonsense,alsoNonsense")).toEqual(defaultHomeWidgets());
  });

  it("inserts a card missing from a saved layout at its catalogue position, not at the end", () => {
    // The regression stock-dashboard learned the hard way: appending would put a card
    // shipped at the top of the catalogue at the bottom of everyone's saved layout.
    // `carousel` is first in the catalogue and absent here, so it must come back first.
    const widgets = resolveHomeWidgets("dailyQuote,todayInHistory,randomPhoto,stockGlance");
    expect(widgets.map((widget) => widget.id)).toEqual([
      "carousel",
      "dailyQuote",
      "todayInHistory",
      "randomPhoto",
      "stockGlance",
    ]);
    expect(widgets.find((widget) => widget.id === "carousel")?.visible).toBe(true);
  });

  it("appends a missing card when nothing in the catalogue follows it", () => {
    // `stockGlance` is last in the catalogue, so it has no successor to anchor before.
    const widgets = resolveHomeWidgets("carousel,dailyQuote,todayInHistory,randomPhoto");
    expect(widgets.at(-1)?.id).toBe("stockGlance");
  });

  it("keeps a deliberate reorder when adding a missing card back", () => {
    // The user put randomPhoto first; restoring carousel must not undo that.
    const widgets = resolveHomeWidgets("randomPhoto,dailyQuote,todayInHistory,stockGlance");
    const ids = widgets.map((widget) => widget.id);
    expect(ids.indexOf("randomPhoto")).toBeLessThan(ids.indexOf("dailyQuote"));
    expect(widgets).toHaveLength(HOME_WIDGET_IDS.length);
  });

  it("survives stray whitespace around tokens", () => {
    const widgets = resolveHomeWidgets(" carousel , -dailyQuote ,, randomPhoto ");
    expect(widgets.find((widget) => widget.id === "dailyQuote")?.visible).toBe(false);
    expect(widgets).toHaveLength(HOME_WIDGET_IDS.length);
  });
});

describe("homeWidgetsToValue", () => {
  it("round-trips a layout through the stored encoding", () => {
    const layout = toggleHomeWidget(defaultHomeWidgets(), "randomPhoto");
    expect(resolveHomeWidgets(homeWidgetsToValue(layout))).toEqual(layout);
  });

  it("marks hidden cards with a hyphen and leaves visible ones bare", () => {
    expect(homeWidgetsToValue(toggleHomeWidget(defaultHomeWidgets(), "dailyQuote"))).toBe(
      "carousel,-dailyQuote,todayInHistory,randomPhoto,stockGlance",
    );
  });

  it("rejects a partial list", () => {
    expect(() => homeWidgetsToValue([{ id: "carousel", visible: true }])).toThrow();
  });

  it("rejects a duplicate", () => {
    const duplicated = [
      ...defaultHomeWidgets().slice(0, -1),
      { id: "carousel" as const, visible: true },
    ];
    expect(() => homeWidgetsToValue(duplicated)).toThrow();
  });

  it("rejects an unknown id", () => {
    expect(() => homeWidgetsSchema.parse([{ id: "notACard", visible: true }])).toThrow();
  });
});

describe("moveHomeWidget", () => {
  it("moves a card up and down by one place", () => {
    const moved = moveHomeWidget(defaultHomeWidgets(), "dailyQuote", "up");
    expect(moved.map((widget) => widget.id).slice(0, 2)).toEqual(["dailyQuote", "carousel"]);
    expect(moveHomeWidget(moved, "dailyQuote", "down").map((widget) => widget.id)).toEqual([
      ...HOME_WIDGET_IDS,
    ]);
  });

  it("returns the list unchanged at either edge rather than wrapping", () => {
    const widgets = defaultHomeWidgets();
    expect(moveHomeWidget(widgets, "carousel", "up")).toEqual(widgets);
    expect(moveHomeWidget(widgets, "stockGlance", "down")).toEqual(widgets);
  });

  it("carries visibility with the card it moves", () => {
    const hidden = toggleHomeWidget(defaultHomeWidgets(), "dailyQuote");
    const moved = moveHomeWidget(hidden, "dailyQuote", "up");
    expect(moved[0]).toEqual({ id: "dailyQuote", visible: false });
  });

  it("returns the list unchanged for an id that is not in it", () => {
    const widgets = defaultHomeWidgets().filter((widget) => widget.id !== "randomPhoto");
    expect(moveHomeWidget(widgets, "randomPhoto", "up")).toEqual(widgets);
  });
});

describe("toggleHomeWidget", () => {
  it("flips one card and leaves the rest alone", () => {
    const toggled = toggleHomeWidget(defaultHomeWidgets(), "randomPhoto");
    expect(toggled.find((widget) => widget.id === "randomPhoto")?.visible).toBe(false);
    expect(toggled.filter((widget) => widget.visible)).toHaveLength(HOME_WIDGET_IDS.length - 1);
  });

  it("is its own inverse", () => {
    const widgets = defaultHomeWidgets();
    expect(toggleHomeWidget(toggleHomeWidget(widgets, "carousel"), "carousel")).toEqual(widgets);
  });
});

describe("visibleHomeWidgets", () => {
  it("lists only visible ids, in order", () => {
    const widgets = moveHomeWidget(
      toggleHomeWidget(defaultHomeWidgets(), "dailyQuote"),
      "randomPhoto",
      "up",
    );
    expect(visibleHomeWidgets(widgets)).toEqual([
      "carousel",
      "randomPhoto",
      "todayInHistory",
      "stockGlance",
    ]);
  });

  it("is empty when everything is hidden", () => {
    const allHidden = defaultHomeWidgets().map((widget) => ({ ...widget, visible: false }));
    expect(visibleHomeWidgets(allHidden)).toEqual([]);
  });
});

describe("isHomeWidgetVisible", () => {
  it("reports a card's stored visibility", () => {
    const widgets = toggleHomeWidget(defaultHomeWidgets(), "stockGlance");
    expect(isHomeWidgetVisible(widgets, "stockGlance")).toBe(false);
    expect(isHomeWidgetVisible(widgets, "carousel")).toBe(true);
  });

  it("defaults to visible for a card absent from a hand-built list", () => {
    expect(isHomeWidgetVisible([], "carousel")).toBe(true);
  });
});
