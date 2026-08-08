// Display options shared by every chart component, and the one piece of real
// logic behind them: deciding *which* points get a value label.
//
// This lives in the lib rather than in the components because it's a rule, not a
// rendering detail — the same rule has to hold for a line, an area and a bar, and
// it needs testing. The components own the SVG; this owns the decision.
//
// The rule it enforces comes from the dataviz skill: "label selectively — never a
// number on every point". A value beside every dot on a 500-point price history is
// unreadable, so "every point" is honoured only up to a cap and downgrades to the
// high/low pair beyond it. See `resolvePointLabelMode`.

/** Which points carry a printed value. */
export type PointLabelMode = "none" | "last" | "extremes" | "all";

/** The modes, in the order a picker should offer them. */
export const POINT_LABEL_MODES: readonly { value: PointLabelMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "last", label: "Latest only" },
  { value: "extremes", label: "High & low" },
  { value: "all", label: "Every point" },
];

/**
 * How many points may be labelled before "every point" stops being readable.
 *
 * Twelve is roughly what fits across a desktop chart without labels touching;
 * callers halve it for a narrow viewport (see `useChartDisplay`), because the
 * same twelve labels across 390px collide.
 */
export const DEFAULT_MAX_POINT_LABELS = 12;

/**
 * The cap on a narrow viewport, where the plot is ~300px wide.
 *
 * Four, not "half of twelve": six labels across a 390px phone was measured and
 * they touch — `$40.33` and `$44.10` ran together. Four leaves ~75px per label
 * against the ~45px each one needs.
 */
export const COMPACT_MAX_POINT_LABELS = 4;

/** The reader-adjustable state of a chart. Every chart component accepts all four. */
export interface ChartDisplay {
  pointLabels: PointLabelMode;
  /** Draw a marker at each data point. */
  showDots: boolean;
  showLegend: boolean;
  showGrid: boolean;
}

/**
 * The display props **every** chart component accepts, so one option means one
 * thing across all of them. Each chart's own props interface extends this.
 *
 * These are the *initial* values, not fixed settings: the reader can change any of
 * them from the chart's own toolbar, and with `displayStorageKey` that choice is
 * remembered. Set them at the call site to choose the starting point.
 */
export interface ChartDisplayDefaults {
  /** Which points print their value. Charts default to `"none"` — bars to `"all"`. */
  pointLabels?: PointLabelMode;
  /** Draw a marker at each data point. */
  showDots?: boolean;
  /** Defaults to "only when there's more than one series". */
  showLegend?: boolean;
  showGrid?: boolean;
  /**
   * Set false to drop the reader's gear control — for a chart whose options are
   * driven from elsewhere, or one too small to carry it.
   */
  showToolbar?: boolean;
  /**
   * Remembers this chart's display choices in `localStorage` under this key.
   * **Give every chart its own**, or two charts share one preference. Omit it and
   * the choices last for the life of the mount.
   */
  displayStorageKey?: string;
}

/**
 * The mode a chart will actually draw, given how many points it has.
 *
 * Separate from `selectLabeledIndexes` so the UI can *say* it downgraded rather
 * than silently ignoring the reader's choice — a toggle that appears to do
 * nothing is worse than one that explains itself.
 */
export function resolvePointLabelMode(
  mode: PointLabelMode,
  pointCount: number,
  maxLabels: number = DEFAULT_MAX_POINT_LABELS,
): PointLabelMode {
  if (mode === "all" && pointCount > maxLabels) return "extremes";
  return mode;
}

/** True when `resolvePointLabelMode` would override the reader's choice. */
export function isPointLabelModeCapped(
  mode: PointLabelMode,
  pointCount: number,
  maxLabels: number = DEFAULT_MAX_POINT_LABELS,
): boolean {
  return resolvePointLabelMode(mode, pointCount, maxLabels) !== mode;
}

/**
 * Which indexes of `values` get a printed label, ascending.
 *
 * Gaps are skipped rather than treated as zero: a sparse series (accounts
 * recorded on different schedules) has `null` where it has no reading, and
 * labelling those as `$0.00` would state a balance that was never recorded.
 * "Latest" therefore means the last index that holds a real number, not
 * `values.length - 1`.
 */
export function selectLabeledIndexes(
  values: readonly (number | string | null | undefined)[],
  mode: PointLabelMode,
  maxLabels: number = DEFAULT_MAX_POINT_LABELS,
): number[] {
  const present: { index: number; value: number }[] = [];
  values.forEach((raw, index) => {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (value == null || !Number.isFinite(value)) return;
    present.push({ index, value: value as number });
  });

  if (present.length === 0) return [];

  switch (resolvePointLabelMode(mode, present.length, maxLabels)) {
    case "none":
      return [];
    case "all":
      return present.map((point) => point.index);
    case "last":
      return [present[present.length - 1].index];
    case "extremes": {
      // First occurrence wins on a tie, so a flat series labels one point rather
      // than the same value twice at either end.
      let lowest = present[0];
      let highest = present[0];
      for (const point of present) {
        if (point.value < lowest.value) lowest = point;
        if (point.value > highest.value) highest = point;
      }
      const indexes = new Set([lowest.index, highest.index]);
      return [...indexes].sort((left, right) => left - right);
    }
  }
}

/**
 * Reads a persisted `ChartDisplay` back, falling back per-field.
 *
 * Deliberately field-by-field rather than all-or-nothing: adding a fifth option
 * later shouldn't discard a reader's stored preference for the other four. Junk
 * (a hand-edited value, an old shape) is ignored the same way a missing field is.
 */
export function parseChartDisplay(raw: string | null | undefined, fallback: ChartDisplay): ChartDisplay {
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;

  const stored = parsed as Record<string, unknown>;
  const mode = stored.pointLabels;

  return {
    pointLabels: POINT_LABEL_MODES.some((option) => option.value === mode)
      ? (mode as PointLabelMode)
      : fallback.pointLabels,
    showDots: typeof stored.showDots === "boolean" ? stored.showDots : fallback.showDots,
    showLegend: typeof stored.showLegend === "boolean" ? stored.showLegend : fallback.showLegend,
    showGrid: typeof stored.showGrid === "boolean" ? stored.showGrid : fallback.showGrid,
  };
}

export function serializeChartDisplay(display: ChartDisplay): string {
  return JSON.stringify(display);
}
