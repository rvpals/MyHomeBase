// Validated categorical palette for chart series identity (see the dataviz skill:
// 8 fixed hues, fixed order — never cycle or re-derive). Kept independent of the
// app's selectable color themes (paper/brass/etc.) since those are all light
// surfaces and series-identity color is a separate concern from brand chrome.
export const CHART_CATEGORICAL_COLORS = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

// Fixed, reserved meaning — never reused for "series N". Always pair with an icon/label.
export const CHART_STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

// Chart chrome that stays legible across every selectable color theme (all light surfaces).
export const CHART_CHROME = {
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  mutedText: "#898781",
} as const;
