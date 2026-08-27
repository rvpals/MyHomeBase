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
    const widgets = resolveDashboardWidgets(settings("statistics,allocation,summary"));
    expect(widgets.map((widget) => widget.id).filter((id) => id !== "indexes")).toEqual([
      "statistics",
      "allocation",
      "summary",
    ]);
  });

  it("reads a '-' prefix as hidden", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-statistics,allocation"));
    expect(widgets.find((widget) => widget.id === "statistics")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(true);
  });

  /** A widget shipped after this layout was saved must not be invisible forever. */
  it("adds a widget missing from the saved value, visible", () => {
    const widgets = resolveDashboardWidgets(settings("summary,statistics"));
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
    // The saved widgets keep their saved order relative to each other.
    const saved = widgets
      .map((widget) => widget.id)
      .filter((id) => id === "summary" || id === "statistics");
    expect(saved).toEqual(["summary", "statistics"]);
  });

  /**
   * Indexes ships at the *top* of the catalogue, and a user with a saved layout
   * has to see it there — appending it would have buried the new card at the
   * bottom of the very dashboards most likely to be in daily use.
   */
  it("inserts a new widget at its catalogue position, not at the end", () => {
    const widgets = resolveDashboardWidgets(settings("summary,statistics,allocation"));
    expect(widgets.map((widget) => widget.id)).toEqual([
      "indexes",
      "summary",
      "statistics",
      "allocation",
    ]);
  });

  /**
   * Anchored to its catalogue neighbour, so a reordered layout stays reordered.
   *
   * Here the user moved `allocation` to the top and `summary` to the bottom.
   * `indexes` lands immediately before `summary` — the first widget that follows
   * it in the catalogue and is present in the layout — rather than at position 0.
   * That's the intended trade: the user's ordering is never overridden, so a new
   * widget goes beside a widget it shipped beside, wherever the user put that one.
   */
  it("keeps a deliberate reorder while placing the new widget by its neighbour", () => {
    const widgets = resolveDashboardWidgets(settings("allocation,-statistics,summary"));
    expect(widgets.map((widget) => widget.id)).toEqual([
      "allocation",
      "statistics",
      "indexes",
      "summary",
    ]);
    // The user's hidden flag survives the insertion.
    expect(widgets.find((widget) => widget.id === "statistics")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "indexes")?.visible).toBe(true);
  });

  /** Nothing follows a catalogue-final widget, so it lands at the end. */
  it("appends a new widget that is last in the catalogue", () => {
    const widgets = resolveDashboardWidgets(settings("indexes,summary,statistics"));
    expect(widgets.map((widget) => widget.id)).toEqual([
      "indexes",
      "summary",
      "statistics",
      "allocation",
    ]);
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
    expect(
      widgets
        .map((widget) => widget.id)
        .filter((id) => id === "summary" || id === "statistics"),
    ).toEqual(["summary", "statistics"]);
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
    expect(
      widgets
        .map((widget) => widget.id)
        .filter((id) => id === "summary" || id === "statistics"),
    ).toEqual(["summary", "statistics"]);
  });

  /** A hidden `-refresh` is just as retired as a visible one. */
  it("drops a saved '-refresh' too", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-refresh,statistics"));
    expect(widgets.map((widget) => widget.id)).not.toContain("refresh");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * The three per-chart allocation widgets became one `allocation` card. A layout
   * saved while they existed must resolve to a working dashboard with the new card
   * present — that's what let the consolidation ship without a migration.
   */
  it("drops the three retired allocation ids and appends 'allocation' visible", () => {
    const widgets = resolveDashboardWidgets(
      settings("summary,allocationType,allocationStrategy,allocationSector,statistics"),
    );
    const ids = widgets.map((widget) => widget.id);
    expect(ids).not.toContain("allocationType");
    expect(ids).not.toContain("allocationStrategy");
    expect(ids).not.toContain("allocationSector");
    expect(ids.filter((id) => id === "summary" || id === "statistics")).toEqual([
      "summary",
      "statistics",
    ]);
    expect(widgets.find((widget) => widget.id === "allocation")).toEqual({
      id: "allocation",
      visible: true,
    });
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * The one behaviour change the consolidation can't preserve: a layout that hid
   * *some* allocation charts gets the combined card back visible, because a single
   * id can't express "type but not sector". Pinned so it reads as a decision.
   */
  it("gives back a visible 'allocation' even when the old charts were hidden", () => {
    const widgets = resolveDashboardWidgets(
      settings("summary,-allocationType,-allocationSector,statistics"),
    );
    expect(widgets.find((widget) => widget.id === "allocation")?.visible).toBe(true);
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  it("keeps the first of a duplicated id rather than rendering it twice", () => {
    const widgets = resolveDashboardWidgets(settings("summary,summary,statistics"));
    expect(widgets.filter((widget) => widget.id === "summary")).toHaveLength(1);
  });

  it("tolerates stray whitespace and empty entries", () => {
    const widgets = resolveDashboardWidgets(settings(" summary , , -statistics ,"));
    expect(widgets.filter((widget) => widget.id !== "indexes" && widget.id !== "allocation")).toEqual([
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
      moveDashboardWidget(defaultDashboardWidgets(), "allocation", "up"),
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
    // Overwrite the last widget with a second "summary": still a full-length list,
    // but one widget appears twice and another not at all.
    layout[layout.length - 1] = { id: "summary", visible: true };
    expect(() => dashboardWidgetsToEntries(layout)).toThrow();
  });
});

describe("moveDashboardWidget", () => {
  it("swaps a widget with the one above it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "statistics", "up");
    expect(moved.slice(1, 3).map((widget) => widget.id)).toEqual(["statistics", "summary"]);
  });

  it("swaps a widget with the one below it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "summary", "down");
    expect(moved.slice(1, 3).map((widget) => widget.id)).toEqual(["statistics", "summary"]);
  });

  it("does nothing at the ends rather than wrapping around", () => {
    const widgets = defaultDashboardWidgets();
    expect(moveDashboardWidget(widgets, "indexes", "up")).toEqual(widgets);
    expect(moveDashboardWidget(widgets, "allocation", "down")).toEqual(widgets);
  });

  it("returns a new list rather than mutating the caller's", () => {
    const widgets = defaultDashboardWidgets();
    const moved = moveDashboardWidget(widgets, "statistics", "up");
    expect(moved).not.toBe(widgets);
    expect(widgets[0].id).toBe("indexes");
  });

  it("carries visibility along with the move", () => {
    const hidden = toggleDashboardWidget(defaultDashboardWidgets(), "statistics");
    const moved = moveDashboardWidget(hidden, "statistics", "up");
    expect(moved[1]).toEqual({ id: "statistics", visible: false });
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
    expect(visibleDashboardWidgets(layout)).toEqual(["indexes", "summary", "allocation"]);
  });
});
