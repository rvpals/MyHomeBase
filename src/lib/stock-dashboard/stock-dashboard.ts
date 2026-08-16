import type { ModuleSetting } from "@/lib/module-settings";
import { dashboardWidgetsSchema } from "./schema";
import type { DashboardWidgetsInput } from "./schema";
import { DASHBOARD_WIDGET_IDS } from "./types";
import type { DashboardWidgetId, DashboardWidgetPreference } from "./types";

/** The module setting the layout is stored under. */
export const DASHBOARD_WIDGETS_SETTING_KEY = "dashboard_widgets";

/** Marks a hidden widget in the stored value. */
const HIDDEN_PREFIX = "-";

const KNOWN_IDS = new Set<string>(DASHBOARD_WIDGET_IDS);

/** Everything visible, in the order the module ships with. */
export function defaultDashboardWidgets(): DashboardWidgetPreference[] {
  return DASHBOARD_WIDGET_IDS.map((id) => ({ id, visible: true }));
}

/**
 * Reads the saved dashboard layout, falling back to the shipped default.
 *
 * Stored as one comma-separated ordered list, a `-` prefix meaning hidden:
 * `summary,refresh,-statistics,allocationType`. Two rules make it survive the app
 * changing underneath it:
 *
 * - An id that's no longer a widget is **dropped** — a removed widget shouldn't
 *   leave a hole, or worse, throw.
 * - A widget missing from the stored value is **appended, visible** — so shipping a
 *   new widget shows it to everyone instead of silently hiding it from every user
 *   who ever saved a layout.
 *
 * Anything unparseable falls back to the default rather than showing a blank
 * dashboard.
 */
export function resolveDashboardWidgets(settings: ModuleSetting[]): DashboardWidgetPreference[] {
  const raw = settings.find((entry) => entry.key === DASHBOARD_WIDGETS_SETTING_KEY)?.value?.trim();
  if (!raw) return defaultDashboardWidgets();

  const seen = new Set<DashboardWidgetId>();
  const resolved: DashboardWidgetPreference[] = [];

  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") continue;

    const visible = !trimmed.startsWith(HIDDEN_PREFIX);
    const id = (visible ? trimmed : trimmed.slice(HIDDEN_PREFIX.length)) as DashboardWidgetId;
    if (!KNOWN_IDS.has(id) || seen.has(id)) continue;

    seen.add(id);
    resolved.push({ id, visible });
  }

  if (resolved.length === 0) return defaultDashboardWidgets();

  // Widgets added to the app since this layout was saved.
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) resolved.push({ id, visible: true });
  }

  return resolved;
}

/**
 * The inverse: a validated layout back to the setting row it's stored as. Keeps the
 * encoding in one place so the reader and the writer can't drift.
 */
export function dashboardWidgetsToEntries(
  input: DashboardWidgetsInput,
): { key: string; value: string }[] {
  const preferences = dashboardWidgetsSchema.parse(input);
  return [
    {
      key: DASHBOARD_WIDGETS_SETTING_KEY,
      value: preferences
        .map((preference) => (preference.visible ? preference.id : `${HIDDEN_PREFIX}${preference.id}`))
        .join(","),
    },
  ];
}

/**
 * Moves one widget up or down by a single place, returning a new list. A widget
 * already at the end it's moving toward is returned unchanged rather than wrapping
 * around — wrapping would make a held-down button cycle forever.
 */
export function moveDashboardWidget(
  preferences: DashboardWidgetPreference[],
  id: DashboardWidgetId,
  direction: "up" | "down",
): DashboardWidgetPreference[] {
  const index = preferences.findIndex((preference) => preference.id === id);
  if (index === -1) return preferences;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= preferences.length) return preferences;

  const next = [...preferences];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Flips one widget's visibility, returning a new list. */
export function toggleDashboardWidget(
  preferences: DashboardWidgetPreference[],
  id: DashboardWidgetId,
): DashboardWidgetPreference[] {
  return preferences.map((preference) =>
    preference.id === id ? { ...preference, visible: !preference.visible } : preference,
  );
}

/** The ids to draw, in order — what the dashboard actually iterates. */
export function visibleDashboardWidgets(
  preferences: DashboardWidgetPreference[],
): DashboardWidgetId[] {
  return preferences.filter((preference) => preference.visible).map((preference) => preference.id);
}
