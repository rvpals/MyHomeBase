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
    const widgets = resolveDashboardWidgets(settings("summary,indexes"));
    expect(widgets.map((widget) => widget.id)).toEqual(["summary", "indexes"]);
  });

  it("reads a '-' prefix as hidden", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-indexes"));
    expect(widgets.find((widget) => widget.id === "indexes")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(true);
  });

  /** A widget shipped after this layout was saved must not be invisible forever. */
  it("adds a widget missing from the saved value, visible", () => {
    const widgets = resolveDashboardWidgets(settings("summary"));
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
    expect(widgets.map((widget) => widget.id)).toContain("summary");
  });

  /**
   * Indexes ships at the *top* of the catalogue, and a user with a saved layout
   * has to see it there — appending it would have buried the new card at the
   * bottom of the very dashboards most likely to be in daily use.
   */
  it("inserts a new widget at its catalogue position, not at the end", () => {
    const widgets = resolveDashboardWidgets(settings("summary"));
    expect(widgets.map((widget) => widget.id)).toEqual(["indexes", "summary"]);
  });

  /**
   * Anchored to its catalogue neighbour, so a reordered layout stays reordered.
   *
   * Here the user hid `summary` and saved a layout naming only it. `indexes` is
   * absent from the layout and nothing in the catalogue follows `summary`, so it
   * lands ahead of it — its catalogue position — while the user's hidden flag on
   * `summary` survives untouched. That's the intended trade: the user's ordering
   * is never overridden, so a new widget goes beside a widget it shipped beside.
   */
  it("keeps a deliberate hide while placing the new widget by its neighbour", () => {
    const widgets = resolveDashboardWidgets(settings("-summary"));
    expect(widgets.map((widget) => widget.id)).toEqual(["indexes", "summary"]);
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(false);
    expect(widgets.find((widget) => widget.id === "indexes")?.visible).toBe(true);
  });

  /** Nothing follows a catalogue-final widget, so it lands at the end. */
  it("appends a new widget that is last in the catalogue", () => {
    const widgets = resolveDashboardWidgets(settings("indexes"));
    expect(widgets.map((widget) => widget.id)).toEqual(["indexes", "summary"]);
  });

  it("drops an id that is no longer a widget", () => {
    const widgets = resolveDashboardWidgets(settings("summary,retiredWidget"));
    expect(widgets.map((widget) => widget.id)).not.toContain("retiredWidget");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * Daily Glance moved to the home screen. Layouts saved before that still name it,
   * and those users must land on a working dashboard rather than a hole or a throw.
   */
  it("drops a saved 'glance', now that the card lives on the home screen", () => {
    const widgets = resolveDashboardWidgets(settings("summary,glance"));
    expect(widgets.map((widget) => widget.id)).not.toContain("glance");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.map((widget) => widget.id)).toContain("summary");
  });

  /**
   * Refresh & snapshot stopped being a widget when the button moved to the section
   * heading. Same contract as `glance` above: a layout saved while it existed must
   * resolve to a working dashboard, which is what lets it retire without a migration.
   */
  it("drops a saved 'refresh', now that the button lives on the heading", () => {
    const widgets = resolveDashboardWidgets(settings("refresh,summary"));
    expect(widgets.map((widget) => widget.id)).not.toContain("refresh");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(widgets.map((widget) => widget.id)).toContain("summary");
  });

  /** A hidden `-refresh` is just as retired as a visible one. */
  it("drops a saved '-refresh' too", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-refresh"));
    expect(widgets.map((widget) => widget.id)).not.toContain("refresh");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * The three per-chart allocation widgets became one `allocation` card, and that
   * card has since become a tab inside Portfolio Summary. All four ids are retired
   * now, so a layout from either era resolves to today's two-widget dashboard.
   */
  it("drops every retired allocation id, from both eras", () => {
    const widgets = resolveDashboardWidgets(
      settings("summary,allocationType,allocationStrategy,allocationSector,allocation"),
    );
    const ids = widgets.map((widget) => widget.id);
    expect(ids).not.toContain("allocationType");
    expect(ids).not.toContain("allocationStrategy");
    expect(ids).not.toContain("allocationSector");
    expect(ids).not.toContain("allocation");
    expect(ids).toContain("summary");
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  /**
   * Statistics and Portfolio Allocation became the Summary tab of the Portfolio
   * Summary card, so their ids retired. A layout saved while they were top-level
   * widgets must still resolve — that's what let the change ship without a migration.
   */
  it("drops saved 'statistics' and 'allocation', now that they are Summary tabs", () => {
    const widgets = resolveDashboardWidgets(settings("statistics,allocation,summary,indexes"));
    const ids = widgets.map((widget) => widget.id);
    expect(ids).not.toContain("statistics");
    expect(ids).not.toContain("allocation");
    // The two surviving widgets keep the order the layout gave them.
    expect(ids).toEqual(["summary", "indexes"]);
  });

  /**
   * The one behaviour change the move to tabs can't preserve: a reader who had
   * hidden Statistics or Allocation gets them back, because they're now part of a
   * card rather than widgets a layout can speak about. Pinned so it reads as a
   * decision rather than a regression.
   */
  it("cannot honour a hidden 'statistics' — it is part of Portfolio Summary now", () => {
    const widgets = resolveDashboardWidgets(settings("summary,-statistics,-allocation"));
    expect(widgets.map((widget) => widget.id)).not.toContain("statistics");
    expect(widgets.find((widget) => widget.id === "summary")?.visible).toBe(true);
    expect(widgets).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  it("keeps the first of a duplicated id rather than rendering it twice", () => {
    const widgets = resolveDashboardWidgets(settings("summary,summary,indexes"));
    expect(widgets.filter((widget) => widget.id === "summary")).toHaveLength(1);
  });

  it("tolerates stray whitespace and empty entries", () => {
    const widgets = resolveDashboardWidgets(settings(" summary , , -indexes ,"));
    expect(widgets).toEqual([
      { id: "summary", visible: true },
      { id: "indexes", visible: false },
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
      moveDashboardWidget(defaultDashboardWidgets(), "summary", "up"),
      "indexes",
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
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "summary", "up");
    expect(moved.map((widget) => widget.id)).toEqual(["summary", "indexes"]);
  });

  it("swaps a widget with the one below it", () => {
    const moved = moveDashboardWidget(defaultDashboardWidgets(), "indexes", "down");
    expect(moved.map((widget) => widget.id)).toEqual(["summary", "indexes"]);
  });

  it("does nothing at the ends rather than wrapping around", () => {
    const widgets = defaultDashboardWidgets();
    expect(moveDashboardWidget(widgets, "indexes", "up")).toEqual(widgets);
    expect(moveDashboardWidget(widgets, "summary", "down")).toEqual(widgets);
  });

  it("returns a new list rather than mutating the caller's", () => {
    const widgets = defaultDashboardWidgets();
    const moved = moveDashboardWidget(widgets, "summary", "up");
    expect(moved).not.toBe(widgets);
    expect(widgets[0].id).toBe("indexes");
  });

  it("carries visibility along with the move", () => {
    const hidden = toggleDashboardWidget(defaultDashboardWidgets(), "summary");
    const moved = moveDashboardWidget(hidden, "summary", "up");
    expect(moved[0]).toEqual({ id: "summary", visible: false });
  });
});

describe("toggleDashboardWidget", () => {
  it("flips just the named widget", () => {
    const toggled = toggleDashboardWidget(defaultDashboardWidgets(), "summary");
    expect(toggled.find((widget) => widget.id === "summary")?.visible).toBe(false);
    expect(toggled.filter((widget) => !widget.visible)).toHaveLength(1);
  });

  it("flips back on a second call", () => {
    const widgets = defaultDashboardWidgets();
    expect(toggleDashboardWidget(toggleDashboardWidget(widgets, "summary"), "summary")).toEqual(
      widgets,
    );
  });
});

describe("visibleDashboardWidgets", () => {
  it("returns the visible ids in order", () => {
    const layout = toggleDashboardWidget(defaultDashboardWidgets(), "summary");
    expect(visibleDashboardWidgets(layout)).toEqual(["indexes"]);
  });
});
