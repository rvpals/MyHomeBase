/**
 * How the *edges* of a frame picture run along a card's sides.
 *
 * This is `border-image-repeat`, named in the domain's own words. The centre of
 * the picture is handled separately (`centerFill`); this governs the four edge
 * strips only, and the corners never scale under any of the three.
 *
 * - `stretch` — one copy of the edge, scaled to the side's length. Right for a
 *   gradient or a plain bevel; wrong for anything with repeating detail, which
 *   smears.
 * - `repeat` — the edge tiles at its natural size, clipped mid-motif at each
 *   end. Right for fine grain where a clipped tile is invisible.
 * - `round` — tiles, but the tile is scaled so a whole number fits. Right for a
 *   rope, a chain or a dentil moulding, where a half-motif at the corner is the
 *   thing you notice.
 */
export type CardFrameFill = "stretch" | "repeat" | "round";

/**
 * Where the nine slices are cut, in **source-image pixels** measured inward
 * from each edge.
 *
 * These cannot be derived — they are a property of the artwork, not of the
 * card. The same 300x300 PNG is a 90px ornate border or a 6px hairline
 * depending only on these four numbers, so the admin types them and watches a
 * preview. Auto-detection would need pixel analysis and would still guess wrong
 * on anything with a soft inner edge.
 */
export interface CardFrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * One frame in the library — **never the image bytes**.
 *
 * Shaped after `DashboardTextureItem`, and the knobs ride on each picture for
 * the same reason migration 0113 gives: an ornate gilt frame and a thin rule
 * want different settings, so selecting a frame should restore the way it was
 * tuned rather than inheriting whatever the last one used.
 */
export interface CardFrame {
  id: number;
  /** What the admin called it, so a gallery is navigable by something other than eyesight. */
  name: string;
  /** Always true for a stored row — `image` is `NOT NULL`, so removal is a DELETE. */
  hasImage: boolean;
  insets: CardFrameInsets;
  /**
   * 0..1, applied to the picture's **centre only** — the card's background.
   *
   * Deliberately not called `opacity`: it does **not** dim the border. A frame
   * faded to 0.3 reads as a rendering fault, while a background faded to 0.3
   * reads as intended, so the two are not one control. Defaults to 1.
   */
  fillOpacity: number;
  fill: CardFrameFill;
  /**
   * Whether the picture's centre is painted as the card's background at all.
   *
   * `false` leaves the theme's own `bg-paper-raised` showing through the middle
   * and uses the picture purely as a border — which is what a frame with a
   * transparent or irrelevant centre wants. `fillOpacity` then has nothing to
   * act on, and the admin screen says so rather than leaving a dead slider.
   */
  centerFill: boolean;
  /**
   * When this row last changed — the image URL's cache-buster. The serving
   * route sends a 5-minute max-age, so without it a replaced picture keeps
   * showing the old bytes.
   */
  updatedAt: string;
}

/** The knobs an admin changes without replacing the picture. */
export type CardFrameSettings = Pick<
  CardFrame,
  "insets" | "fillOpacity" | "fill" | "centerFill"
>;

/**
 * Which frame every `CustomizableCard` draws, application-wide.
 *
 * A pinned single row (`sys_card_frame`, id = 1) pointing into the library,
 * mirroring the `sys_dashboard_texture` / `sys_dashboard_textures` split — the
 * selection is read on every protected render, so it must be readable without
 * touching a BLOB.
 *
 * `frame` undefined is the "no frame" state: nothing selected, or a selection
 * pointing at a row that has since been deleted. Both render as the card looks
 * today, which is why neither is an error.
 */
export interface CardFrameSelection {
  frame?: CardFrame;
}
