/** How a texture picture is laid out behind the dashboard. */
export type DashboardTextureMode = "cover" | "tile";

/**
 * One picture in the dashboard's texture library — **never the image bytes**.
 *
 * The display knobs ride on each picture rather than on the application
 * (migration 0113): a dark photograph and a pale seamless pattern want very
 * different opacities, so selecting a texture restores the way it was tuned.
 *
 * `hasImage` is present for symmetry with `DashboardTexture` and is always true
 * for a stored row — `sys_dashboard_textures.image` is `NOT NULL`, because the
 * way to remove a library entry is to delete it. It exists so a caller can hand
 * an item and the selected texture to the same rendering code.
 */
export interface DashboardTextureItem {
  id: number;
  /** What the admin called it, so a grid of 20 thumbnails is navigable. */
  name: string;
  hasImage: boolean;
  /** 0..1. Low by default — a picture behind text has to stay quiet. */
  opacity: number;
  mode: DashboardTextureMode;
  /** Gaussian blur in px, 0..40. 0 leaves the picture untouched. */
  blur: number;
  /**
   * When this row last changed, which is what makes it usable as the image
   * URL's cache-buster: the serving route sends a 5-minute max-age, so without
   * it a replaced picture would keep showing the old bytes.
   */
  updatedAt: string;
}

/**
 * What the dashboard draws — the selected library picture, flattened.
 *
 * The same shape it had before migration 0113, plus `selectedId` and — since
 * 0116 — `appWide`. The screens hand this to `resolveAppTexture` and neither
 * know nor care that there is a library behind it.
 *
 * `hasImage` false — with `selectedId` undefined — is the "no texture" state:
 * nothing selected, or a selection pointing at a row that has since been
 * deleted. Both render as the theme's flat paper.
 */
export interface DashboardTexture {
  /** The selected library row, or `undefined` when nothing is selected. */
  selectedId?: number;
  /**
   * Whether the selected picture is drawn behind **every** authenticated screen
   * or behind the home dashboard alone (migration 0116).
   *
   * Scope lives here, on the selection, rather than on each library picture:
   * unlike opacity/mode/blur it describes the installation's intent, not the
   * image, so it must not change when a different texture is selected.
   *
   * A module with its own picture still wins on its own screens — see
   * `src/lib/app-texture/`, which is the only place the two are combined.
   */
  appWide: boolean;
  hasImage: boolean;
  opacity: number;
  mode: DashboardTextureMode;
  blur: number;
  updatedAt: string;
}

/** The knobs an admin can change without touching the picture itself. */
export type DashboardTextureSettings = Pick<DashboardTexture, "opacity" | "mode" | "blur">;
