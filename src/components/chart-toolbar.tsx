"use client";

// The reader's controls for how a chart is drawn: value labels, point markers,
// the legend and the gridlines. Every chart component mounts one, so the same
// four options mean the same thing everywhere and are named the same way.
//
// A gear popover rather than a visible control row: a dashboard stacks several
// charts, and a permanent strip of checkboxes above each one competes with the
// data for attention — and wraps to two lines on a phone. One quiet icon reads
// the same at 390px as at 1920px.
//
// Props in, events out: it owns the popover's open state and nothing else. The
// chart owns the `ChartDisplay` (see `useChartDisplay` below, which is where the
// persistence lives).

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { useIsCompact } from "@/components/viewport-context";
import {
  CHART_ENCODINGS,
  COMPACT_MAX_POINT_LABELS,
  DEFAULT_MAX_POINT_LABELS,
  POINT_LABEL_MODES,
  isPointLabelModeCapped,
  parseChartDisplay,
  serializeChartDisplay,
  type ChartDisplay,
  type ChartEncoding,
  type PointLabelMode,
} from "@/lib/shared/chart-options";

export interface ChartToolbarProps {
  /** Current display state — the chart owns it. */
  value: ChartDisplay;
  onChange: (next: ChartDisplay) => void;
  /**
   * Which label modes to offer. Defaults to all four. A bar chart passes
   * `["none", "all"]`: "latest" and "high & low" are time-series ideas, and every
   * bar already has a free end to print its own value on.
   */
  labelModes?: readonly PointLabelMode[];
  /**
   * Which encodings this chart's data can honestly be drawn as. Omit it — or pass
   * one — and no type picker appears, which is the case for most charts.
   *
   * The call site decides, not the toolbar, because honesty depends on the data:
   * `scatter` needs a numeric x, and a chart keyed by date can't offer it. A chart
   * whose categories have no order shouldn't offer `line` at all.
   */
  chartTypes?: readonly ChartEncoding[];
  /**
   * Set false to hide a toggle that can't apply — a single series has no legend to
   * turn off, a bar chart has no markers, and a series drawing custom marks
   * (`renderDot`) would lose real meaning if they were hidden.
   */
  canToggleDots?: boolean;
  canToggleLegend?: boolean;
  canToggleGrid?: boolean;
  /**
   * How many points the densest series holds. Used only to warn when "every
   * point" has been capped — pass it and the panel explains itself.
   */
  pointCount?: number;
  maxPointLabels?: number;
  /** Extra controls placed left of the gear — ChartXY's zoom buttons. */
  children?: ReactNode;
  /**
   * Set false to drop the gear itself while keeping `children`. For a chart whose
   * toolbar carries controls of its own (ChartXY's zoom) that must survive even
   * when the display options are switched off.
   */
  showOptions?: boolean;
  className?: string;
}

const CHECKBOX_ROW_CLASS =
  "flex cursor-pointer items-center gap-2 py-1 text-sm text-ink select-none";
// Matches the checkboxes in the module views (see csv-analytics-view.tsx).
const CHECKBOX_CLASS =
  "h-4 w-4 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
const SELECT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ChartToolbar({
  value,
  onChange,
  labelModes,
  chartTypes,
  canToggleDots = true,
  canToggleLegend = true,
  canToggleGrid = true,
  pointCount,
  maxPointLabels = DEFAULT_MAX_POINT_LABELS,
  children,
  showOptions = true,
  className = "",
}: ChartToolbarProps) {
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const modes = useMemo(
    () =>
      labelModes === undefined
        ? POINT_LABEL_MODES
        : POINT_LABEL_MODES.filter((option) => labelModes.includes(option.value)),
    [labelModes],
  );

  // Kept in the shared order rather than the caller's, so the list reads the same
  // way on every chart that offers it.
  const encodings = useMemo(
    () => (chartTypes === undefined ? [] : CHART_ENCODINGS.filter((option) => chartTypes.includes(option.value))),
    [chartTypes],
  );
  // One encoding is not a choice, and a chart with no `chartType` in its display
  // state isn't offering one.
  const canSwitchType = encodings.length > 1 && value.chartType !== undefined;

  // Clicking elsewhere closes the panel. Registered only while open, so a
  // dashboard of charts doesn't keep a listener each.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const isCapped =
    pointCount !== undefined && isPointLabelModeCapped(value.pointLabels, pointCount, maxPointLabels);

  return (
    <div className={`flex items-center justify-end gap-2 ${className}`}>
      {children}
      {!showOptions ? null : (
      <div ref={containerRef} className="relative">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setIsOpen(!isOpen)}
          ariaExpanded={isOpen}
          ariaControls={panelId}
          ariaLabel="Chart display options"
          title="Chart display options"
        >
          <span aria-hidden="true">⚙</span>
        </Button>
        {isOpen && (
          <div
            id={panelId}
            className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-line bg-paper p-3 shadow-lg"
          >
            {canSwitchType && (
              // First in the panel: it changes what the other options *mean* — a
              // scatter has no line for "point markers" to sit on — so it reads as
              // the parent choice it is.
              <label className="mb-2 block border-b border-line pb-2">
                <span className="mb-1 block text-xs font-medium text-muted">Chart type</span>
                <select
                  value={value.chartType}
                  onChange={(event) =>
                    onChange({ ...value, chartType: event.target.value as ChartEncoding })
                  }
                  className={SELECT_CLASS}
                >
                  {encodings.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modes.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Data point values</span>
                <select
                  value={value.pointLabels}
                  onChange={(event) =>
                    onChange({ ...value, pointLabels: event.target.value as PointLabelMode })
                  }
                  className={SELECT_CLASS}
                >
                  {modes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isCapped && (
              <p className="mt-1 text-xs text-muted">
                Too many points to label every one — showing the high and low.
              </p>
            )}
            <div className="mt-2 border-t border-line pt-2">
              {canToggleDots && (
                <label className={CHECKBOX_ROW_CLASS}>
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={value.showDots}
                    onChange={(event) => onChange({ ...value, showDots: event.target.checked })}
                  />
                  Point markers
                </label>
              )}
              {canToggleLegend && (
                <label className={CHECKBOX_ROW_CLASS}>
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={value.showLegend}
                    onChange={(event) => onChange({ ...value, showLegend: event.target.checked })}
                  />
                  Legend
                </label>
              )}
              {canToggleGrid && (
                <label className={CHECKBOX_ROW_CLASS}>
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={value.showGrid}
                    onChange={(event) => onChange({ ...value, showGrid: event.target.checked })}
                  />
                  Gridlines
                </label>
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Holds a chart's display state, seeded by the call site's props and — with a
 * `storageKey` — remembered per chart in `localStorage`.
 *
 * Returns the label cap as well, halved on a narrow viewport: twelve labels fit
 * across a desktop chart and collide on a 390px phone, so the same "every point"
 * choice has to mean fewer labels there.
 */
export function useChartDisplay(
  defaults: Partial<ChartDisplay>,
  storageKey?: string,
): { display: ChartDisplay; setDisplay: (next: ChartDisplay) => void; maxPointLabels: number } {
  const isCompact = useIsCompact();

  const {
    pointLabels = "none",
    showDots = true,
    showLegend = false,
    showGrid = true,
    // No default: undefined is the honest value for a chart that doesn't switch,
    // and a chart that does always passes its starting encoding.
    chartType,
  } = defaults;
  const resolvedDefaults = useMemo<ChartDisplay>(
    () => ({ pointLabels, showDots, showLegend, showGrid, chartType }),
    [pointLabels, showDots, showLegend, showGrid, chartType],
  );

  const [display, setDisplay] = useState<ChartDisplay>(resolvedDefaults);

  // Stored preferences are read in an effect, not during render: `localStorage`
  // doesn't exist on the server, and reading it in the initializer would make the
  // first client render disagree with the server's HTML. The chart therefore draws
  // once with the call site's defaults before a stored preference lands — fine for
  // a display option, and the alternative is a hydration mismatch.
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (!storageKey) {
      hasLoaded.current = true;
      return;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         Syncing from an external system (localStorage) on mount, not reacting to
         React state. Same pattern as DataGrid's stored view. */
      setDisplay(parseChartDisplay(stored, resolvedDefaults));
    } catch {
      // Storage can be unavailable (private browsing). The defaults still apply.
    }
    hasLoaded.current = true;
  }, [storageKey, resolvedDefaults]);

  // Guarded by `hasLoaded` so this doesn't overwrite the stored value with the
  // defaults on the first pass, before the read above has run.
  useEffect(() => {
    if (!storageKey || !hasLoaded.current) return;
    try {
      window.localStorage.setItem(storageKey, serializeChartDisplay(display));
    } catch {
      // Not worth surfacing — the session still honours the choice.
    }
  }, [storageKey, display]);

  return {
    display,
    setDisplay,
    maxPointLabels: isCompact ? COMPACT_MAX_POINT_LABELS : DEFAULT_MAX_POINT_LABELS,
  };
}
