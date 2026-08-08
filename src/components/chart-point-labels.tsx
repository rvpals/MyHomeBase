"use client";

// Shared renderer for the value labels that ride a chart's marks. Used by every
// chart component through Recharts' `<LabelList content={…}>` slot, so a labelled
// point looks the same whether it sits on a line, an area, a column or a bar.
//
// Which points get a label is decided in the lib
// (`selectLabeledIndexes` in src/lib/shared/chart-options.ts) — this only draws
// the ones it's handed. Labels wear the muted *text* token, never the series
// colour: a light categorical hue (yellow, aqua) is illegible as text on the
// surface, and identity already comes from the mark beside it.

import { CHART_CHROME } from "./chart-colors";

/** Where a label sits relative to its mark. */
export type PointLabelPlacement =
  /** Above the point — lines and areas. */
  | "above"
  /** On the cap — vertical columns. */
  | "cap"
  /** Past the tip — horizontal bars. */
  | "right";

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET = 6;

interface RechartsLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  index?: number;
  /** The whole row, when Recharts supplies it — see `matchField` below. */
  payload?: Record<string, unknown>;
}

function toNumber(value: number | string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Builds a `content` renderer for `<LabelList>`.
 *
 * `indexes` is the allow-list; anything else draws nothing. `lastIndex` lets the
 * label on the final point anchor to its right edge instead of centring and
 * spilling past the plot area.
 *
 * **Why there are two ways to match a point.** The allow-list is computed over the
 * caller's `data` array, but Recharts numbers the entries it actually plots — and
 * a series that omits its key on some rows (a sparse series, drawn with
 * `connectNulls`) doesn't plot one entry per row, so the two can drift apart and
 * the label would land on the wrong point. When `matchField` and `allowedKeys` are
 * supplied, identity comes from the row's own x value instead, which can't drift.
 * The index is the fallback for whatever Recharts doesn't hand a payload to.
 */
export function pointLabelContent({
  indexes,
  formatValue,
  placement,
  lastIndex,
  matchField,
  allowedKeys,
}: {
  indexes: readonly number[];
  formatValue: (value: number) => string;
  placement: PointLabelPlacement;
  lastIndex?: number;
  /** Field on the row that identifies a point — normally the chart's `xKey`. */
  matchField?: string;
  /** That field's value for each allowed point, from the same rows as `indexes`. */
  allowedKeys?: readonly (string | number)[];
}) {
  const allowed = new Set(indexes);
  const allowedByKey = new Set((allowedKeys ?? []).map((key) => String(key)));

  return function renderPointLabel(props: unknown) {
    const label = props as RechartsLabelProps;
    const index = label.index;

    const rowKey = matchField == null ? undefined : label.payload?.[matchField];
    const isAllowed =
      rowKey != null && allowedByKey.size > 0
        ? allowedByKey.has(String(rowKey))
        : index != null && allowed.has(index);
    if (!isAllowed) return null;

    const value = toNumber(label.value);
    const x = toNumber(label.x);
    const y = toNumber(label.y);
    if (value === undefined || x === undefined || y === undefined) return null;

    const width = toNumber(label.width) ?? 0;
    const height = toNumber(label.height) ?? 0;

    let textX = x;
    let textY = y;
    let anchor: "start" | "middle" | "end" = "middle";
    let baseline: "middle" | "auto" = "auto";

    switch (placement) {
      case "right":
        textX = x + width + LABEL_OFFSET;
        textY = y + height / 2;
        anchor = "start";
        baseline = "middle";
        break;
      case "cap":
        textX = x + width / 2;
        textY = y - LABEL_OFFSET;
        break;
      case "above":
        textY = y - LABEL_OFFSET - 2;
        // The final point's label would otherwise centre on the plot's right edge
        // and lose its second half to the container.
        if (lastIndex !== undefined && index === lastIndex) anchor = "end";
        break;
    }

    return (
      <text
        x={textX}
        y={textY}
        textAnchor={anchor}
        dominantBaseline={baseline}
        fill={CHART_CHROME.mutedText}
        fontSize={LABEL_FONT_SIZE}
      >
        {formatValue(value)}
      </text>
    );
  };
}
