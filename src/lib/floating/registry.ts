import type { FloatingComponentInfo, FloatingId } from "./types";

/**
 * THE registry of floating components.
 *
 * ## Adding one
 *
 * 1. Add its id to `FloatingId` in `types.ts`.
 * 2. Add an entry here.
 * 3. Render it in `FloatingLayer` (`src/components/floating-layer.tsx`).
 *
 * Steps 1 and 2 alone are inert — a registered component the layer doesn't render shows
 * up on the admin screen as a switch that does nothing, so do all three together.
 *
 * The ids are persisted in two places (the app-wide enabled list and each reader's own
 * state rows), so **treat an id as permanent once shipped** — the same rule
 * `ICON_SLOTS` carries, and for the same reason.
 */
export const FLOATING_COMPONENTS: readonly FloatingComponentInfo[] = [
  {
    id: "clock",
    label: "Floating Clock",
    description:
      "A clock that floats over every page — digital or analog, with the date, weekday and weather it shows on the home screen.",
    enabledByDefault: false,
  },
  {
    id: "calculator",
    label: "Floating Calculator",
    description:
      "A scientific calculator over every page — trigonometry, logs, powers and a history tape. Minimizes to show the last result.",
    enabledByDefault: false,
  },
  {
    id: "scratchpad",
    label: "Scratchpad",
    description:
      "A notepad over every page, with a tab per category of notes. Notes save as you type and are yours alone; an administrator sets the categories.",
    enabledByDefault: false,
  },
];

/** One component by id, or `undefined` when nothing matches. */
export function getFloatingComponent(id: string): FloatingComponentInfo | undefined {
  return FLOATING_COMPONENTS.find((component) => component.id === id);
}

/** Whether `id` names a registered floating component — the type guard for stored rows. */
export function isFloatingId(id: string): id is FloatingId {
  return FLOATING_COMPONENTS.some((component) => component.id === id);
}

/** The ids that ship enabled, for a household whose setting row has never been written. */
export function defaultEnabledIds(): FloatingId[] {
  return FLOATING_COMPONENTS.filter((component) => component.enabledByDefault).map(
    (component) => component.id,
  );
}

/**
 * The app-wide enabled list, parsed from its stored form.
 *
 * Stored as a comma-separated list of ids in one `sys_settings` row rather than a row
 * per component, matching how `home_widgets` stores the dashboard order: the set is
 * small, always read together, and a new component must not need a migration.
 *
 * Unknown ids are dropped rather than throwing. A component removed from the registry
 * in a later release leaves its id behind in the stored value, and an admin screen that
 * crashed on a stale row would be unfixable through the UI — the one place you'd go to
 * fix it. Duplicates collapse for the same reason.
 *
 * A **blank** value means "nothing enabled", not "use the defaults": it is what the
 * admin screen writes when every switch is off, and reading it as the defaults would
 * make disabling the last component impossible. Only a genuinely absent row
 * (`undefined`) falls back — see `resolveEnabledFloating`.
 */
export function parseEnabledFloating(value: string): FloatingId[] {
  const seen = new Set<FloatingId>();
  for (const part of value.split(",")) {
    const id = part.trim();
    if (isFloatingId(id)) seen.add(id);
  }
  // Registry order, not stored order: this list drives both screens' rendering, and the
  // order an admin happened to tick the boxes in is not a preference worth preserving.
  return FLOATING_COMPONENTS.filter((component) => seen.has(component.id)).map(
    (component) => component.id,
  );
}

/** The enabled list as stored. Registry order, so the value is stable across saves. */
export function enabledFloatingToValue(ids: readonly FloatingId[]): string {
  const seen = new Set(ids);
  return FLOATING_COMPONENTS.filter((component) => seen.has(component.id))
    .map((component) => component.id)
    .join(",");
}

/**
 * The enabled list for a household, defaults included.
 *
 * `undefined` (no row at all) resolves to the shipped defaults; any string, blank
 * included, is taken at its word. That distinction is the whole point of this function
 * existing beside `parseEnabledFloating`.
 */
export function resolveEnabledFloating(value: string | undefined): FloatingId[] {
  return value === undefined ? defaultEnabledIds() : parseEnabledFloating(value);
}

/** The setting key the enabled list lives under. */
export const FLOATING_ENABLED_SETTING_KEY = "floating_enabled";
