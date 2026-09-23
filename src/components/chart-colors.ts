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
  /**
   * A reader-defined benchmark drawn across the plot — an aggregate, a target.
   *
   * Deliberately NOT `axis`. Grid and axis are recessive by design (they are there
   * to be looked past), and a reference line borrowed from that palette was so faint
   * on screen it read as an artefact rather than a value someone asked for. This is a
   * near-black ink that reads at a glance while still sitting outside
   * `CHART_CATEGORICAL_COLORS` — so a benchmark can never be mistaken for a measured
   * series, which is why it isn't simply given a series hue.
   */
  reference: "#3a372f",
  /** Backing for a reference line's label, so it stays readable over a dense plot. */
  referenceLabelBackground: "#fffdf7",
} as const;

/**
 * Hues for a SECOND and subsequent reference line on one chart.
 *
 * Several benchmarks drawn in the one `CHART_CHROME.reference` ink would be
 * indistinguishable, so each takes its own. Deliberately darker and more saturated
 * than `CHART_CATEGORICAL_COLORS` — an annotation has to out-read the data it is
 * drawn over, which is the opposite of what a series hue is tuned for — and kept as
 * its own list so adding a reference line can never consume a series colour slot.
 */
export const CHART_REFERENCE_COLORS = [
  "#b3261e", // deep red
  "#1c5d99", // deep blue
  "#6a4a00", // bronze
  "#5b2d8e", // deep violet
  "#0f6b4f", // deep teal
] as const;
