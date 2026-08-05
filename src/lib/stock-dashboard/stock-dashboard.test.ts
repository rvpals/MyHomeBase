import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
import {
  DASHBOARD_WIDGETS_SETTING_KEY,
  dashboardWidgetsToEntries,
  defaultDashboardWidgets,
  moveDashboardWidget,
  resolveDashboardWidgets,
  toggleDashboardWidget,
  visibleDashboardWidgets,
} from "./stock-dashboard";
import { DASHBOARD_WIDGET_IDS, DASHBOARD_WIDGET_INFO } from "./types";

function settings(value: string): ModuleSetting[] {
  return [{ id: 1, moduleId: 3, key: DASHBOARD_WIDGETS_SETTING_KEY, value }];
}

describe("DASHBOARD_WIDGET_INFO", () => {
  it("describes every widget, so none can appear in Configuration unlabelled", () => {
    for (const id of DASHBOARD_WIDGET_IDS) {
      expect(DASHBOARD_WIDGET_INFO[id]?.label).toBeTruthy();
      expect(DASHBOARD_WIDGET_INFO[id]?.description).toBeTruthy();
    }
  });
});

describe("defaultDashboardWidgets", () => {
  it("shows everything, in the shipped order", () => {
    const widgets = defaultDashboardWidgets();
    expect(widgets.map((widget) => widget.id)).toEqual([...DASHBOARD_WIDGET_IDS]);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
  });
});

describe("resolveDashboardWidgets", () => {
  it("falls back to the default when nothing is saved", () => {
    expect(resolveDashboardWidgets([])).toEqual(defaultDashboardWidgets());
    expect(resolveDashboardWidgets(settings("   "))).toEqual(defaultDashboardWidgets());
  });

  it("reads a saved order", () => {
    const widgets = resolveDashboardWidgets(
      settings("glance,summary,refresh,statistics,allocationType,allocationStrategy"),
    );
    expect(widgets.slice(0, 3).map((widget) => widget.id)).toEqual([
      "glance",
      "summary",
      "refresh",
    ]);
  });

  it("reads a '-' prefix as hidden", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-glance,statistics"));
    expect(widgets.find((widget) => widget.id === "glance")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(true);
  });

  /** A widget shipped after this layout was saved must not be invisible forever. */
  it("appends a widget missing from the saved value, visible", () => {
    const widgets = resolveDashboardWidgets(settings("summary,glance"));
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "glance"]);
    expect(widgets.slice(2).every((widget) => widget.visible)).toBe(true);
  });

  it("drops an id that is no longer a widget", () => {
    const widgets = resolveDashboardWidgets(settings("summary,retiredWidget,glance"));
    expect(widgets.map((widget) => widget.id)).not.toContain("retiredWidget");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  it("keeps the first of a duplicated id rather than rendering it twice", () => {
    const widgets = resolveDashboardWidgets(settings("summary,summary,glance"));
    expect(widgets.filter((widget) => widget.id === "summary")).toHaveLength(1);
  });

  it("tolerates stray whitespace and empty entries", () => {
    const widgets = resolveDashboardWidgets(settings(" summary , , -glance ,"));
    expect(widgets.slice(0, 2)).toEqual([
      { id: "summary", visible: true },
      { id: "glance", visible: false },
    ]);
  });

  it("falls back to the default when nothing in the value is recognisable", () => {
    expect(resolveDashboardWidgets(settings("nonsense,alsoNonsense"))).toEqual(
      defaultDashboardWidgets(),
    );
  });

  it("survives every widget being hidden — that's a choice, not a parse failure", () => {
    const value = DASHBOARD_WIDGET_IDS.map((id) => `-${id}`).join(",");
    const widgets = resolveDashboardWidgets(settings(value));
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(visibleDashboardWidgets(widgets)).toEqual([]);
  });
});

describe("dashboardWidgetsToEntries", () => {
  it("writes the key resolveDashboardWidgets reads", () => {
    const entries = dashboardWidgetsToEntries(defaultDashboardWidgets());
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(DASHBOARD_WIDGETS_SETTING_KEY);
  });

  it("round-trips an order with a hidden widget", () => {
    const layout = toggleDashboardWidget(
      moveDashboardWidget(defaultDashboardWidgets(), "glance", "up"),
      "statistics",
    );
    const entries = dashboardWidgetsToEntries(layout);
    const restored = resolveDashboardWidgets(
      entries.map((entry, index) => ({ id: index + 1, moduleId: 3, ...entry })),
    );
    expect(restored).toEqual(layout);
  });

  it("rejects a partial list, which would leave the order ambiguous", () => {
    expect(() => dashboardWidgetsToEntries([{ id: "summary", visible: true }])).toThrow();
  });

  it("rejects a duplicated widget, which would render it twice", () => {
    const layout = defaultDashboardWidgets();
    // Overwrite "glance" with a second "summary": still six entries, but one
    // widget appears twice and another not at all.
    layout[2] = { id: "summary", visible: true };
    expect(() => dashboardWidgetsToEntries(layout)).toThrow();
  });
});

describe("moveDashboardWidget", () => {
  it("swaps a widget with the one above it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "summary", "up");
    expect(moved.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "refresh"]);
  });

  it("swaps a widget with the one below it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "refresh", "down");
    expect(moved.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "refresh"]);
  });

  it("does nothing at the ends rather than wrapping around", () => {
    const widgets = defaultDashboardWidgets();
    expect(moveDashboardWidget(widgets, "refresh", "up")).toEqual(widgets);
    expect(moveDashboardWidget(widgets, "allocationStrategy", "down")).toEqual(widgets);
  });

  it("returns a new list rather than mutating the caller's", () => {
    const widgets = defaultDashboardWidgets();
    const moved = moveDashboardWidget(widgets, "summary", "up");
    expect(moved).not.toBe(widgets);
    expect(widgets[0].id).toBe("refresh");
  });

  it("carries visibility along with the move", () => {
    const hidden = toggleDashboardWidget(defaultDashboardWidgets(), "summary");
    const moved = moveDashboardWidget(hidden, "summary", "up");
    expect(moved[0]).toEqual({ id: "summary", visible: false });
  });
});

describe("toggleDashboardWidget", () => {
  it("flips just the named widget", () => {
    const toggled = toggleDashboardWidget(defaultDashboardWidgets(), "glance");
    expect(toggled.find((widget) => widget.id === "glance")?.visible).toBe(false);
    expect(toggled.filter((widget) => !widget.visible)).toHaveLength(1);
  });

  it("flips back on a second call", () => {
    const widgets = defaultDashboardWidgets();
    expect(toggleDashboardWidget(toggleDashboardWidget(widgets, "glance"), "glance")).toEqual(widgets);
  });
});

describe("visibleDashboardWidgets", () => {
  it("returns the visible ids in order", () => {
    const layout = toggleDashboardWidget(defaultDashboardWidgets(), "refresh");
    expect(visibleDashboardWidgets(layout)).toEqual([
      "summary",
      "glance",
      "statistics",
      "allocationType",
      "allocationStrategy",
    ]);
  });
});
