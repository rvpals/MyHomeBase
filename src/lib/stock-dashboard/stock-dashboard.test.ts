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
      settings("statistics,allocationType,summary,allocationStrategy"),
    );
    expect(widgets.slice(0, 3).map((widget) => widget.id)).toEqual([
      "statistics",
      "allocationType",
      "summary",
    ]);
  });

  it("reads a '-' prefix as hidden", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-statistics,allocationType"));
    expect(widgets.find((widget) => widget.id === "statistics")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(true);
  });

  /** A widget shipped after this layout was saved must not be invisible forever. */
  it("appends a widget missing from the saved value, visible", () => {
    const widgets = resolveDashboardWidgets(settings("summary,statistics"));
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "statistics"]);
    expect(widgets.slice(2).every((widget) => widget.visible)).toBe(true);
  });

  it("drops an id that is no longer a widget", () => {
    const widgets = resolveDashboardWidgets(settings("summary,retiredWidget,statistics"));
    expect(widgets.map((widget) => widget.id)).not.toContain("retiredWidget");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * Daily Glance moved to the home screen. Layouts saved before that still name it,
   * and those users must land on a working dashboard rather than a hole or a throw.
   */
  it("drops a saved 'glance', now that the card lives on the home screen", () => {
    const widgets = resolveDashboardWidgets(settings("summary,glance,statistics"));
    expect(widgets.map((widget) => widget.id)).not.toContain("glance");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "statistics"]);
  });

  /**
   * Refresh & snapshot stopped being a widget when the button moved to the section
   * heading. Same contract as `glance` above: a layout saved while it existed must
   * resolve to a working dashboard, which is what lets it retire without a migration.
   */
  it("drops a saved 'refresh', now that the button lives on the heading", () => {
    const widgets = resolveDashboardWidgets(settings("refresh,summary,statistics"));
    expect(widgets.map((widget) => widget.id)).not.toContain("refresh");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.slice(0, 2).map((widget) => widget.id)).toEqual(["summary", "statistics"]);
  });

  /** A hidden `-refresh` is just as retired as a visible one. */
  it("drops a saved '-refresh' too", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-refresh,statistics"));
    expect(widgets.map((widget) => widget.id)).not.toContain("refresh");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  it("keeps the first of a duplicated id rather than rendering it twice", () => {
    const widgets = resolveDashboardWidgets(settings("summary,summary,statistics"));
    expect(widgets.filter((widget) => widget.id === "summary")).toHaveLength(1);
  });

  it("tolerates stray whitespace and empty entries", () => {
    const widgets = resolveDashboardWidgets(settings(" summary , , -statistics ,"));
    expect(widgets.slice(0, 2)).toEqual([
      { id: "summary", visible: true },
      { id: "statistics", visible: false },
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
      moveDashboardWidget(defaultDashboardWidgets(), "allocationType", "up"),
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
    // Overwrite "statistics" with a second "summary": still a full-length list, but
    // one widget appears twice and another not at all.
    layout[2] = { id: "summary", visible: true };
    expect(() => dashboardWidgetsToEntries(layout)).toThrow();
  });
});

describe("moveDashboardWidget", () => {
  it("swaps a widget with the one above it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "statistics", "up");
    expect(moved.slice(0, 2).map((widget) => widget.id)).toEqual(["statistics", "summary"]);
  });

  it("swaps a widget with the one below it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "summary", "down");
    expect(moved.slice(0, 2).map((widget) => widget.id)).toEqual(["statistics", "summary"]);
  });

  it("does nothing at the ends rather than wrapping around", () => {
    const widgets = defaultDashboardWidgets();
    expect(moveDashboardWidget(widgets, "summary", "up")).toEqual(widgets);
    expect(moveDashboardWidget(widgets, "allocationSector", "down")).toEqual(widgets);
  });

  it("returns a new list rather than mutating the caller's", () => {
    const widgets = defaultDashboardWidgets();
    const moved = moveDashboardWidget(widgets, "statistics", "up");
    expect(moved).not.toBe(widgets);
    expect(widgets[0].id).toBe("summary");
  });

  it("carries visibility along with the move", () => {
    const hidden = toggleDashboardWidget(defaultDashboardWidgets(), "statistics");
    const moved = moveDashboardWidget(hidden, "statistics", "up");
    expect(moved[0]).toEqual({ id: "statistics", visible: false });
  });
});

describe("toggleDashboardWidget", () => {
  it("flips just the named widget", () => {
    const toggled = toggleDashboardWidget(defaultDashboardWidgets(), "statistics");
    expect(toggled.find((widget) => widget.id === "statistics")?.visible).toBe(false);
    expect(toggled.filter((widget) => !widget.visible)).toHaveLength(1);
  });

  it("flips back on a second call", () => {
    const widgets = defaultDashboardWidgets();
    expect(
      toggleDashboardWidget(toggleDashboardWidget(widgets, "statistics"), "statistics"),
    ).toEqual(widgets);
  });
});

describe("visibleDashboardWidgets", () => {
  it("returns the visible ids in order", () => {
    const layout = toggleDashboardWidget(defaultDashboardWidgets(), "statistics");
    expect(visibleDashboardWidgets(layout)).toEqual([
      "summary",
      "allocationType",
      "allocationStrategy",
      "allocationSector",
    ]);
  });
});
