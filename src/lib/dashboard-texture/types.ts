/** How a texture picture is laid out behind the dashboard. */
export type DashboardTextureMode = "cover" | "tile";

/**
 * The dashboard texture's settings — **never the image bytes**.
 *
 * `hasImage` is computed in SQL (`image IS NOT NULL`) so the root layout can
 * decide whether to emit a texture layer at all without any read pulling a
 * multi-megabyte BLOB into a page render. The bytes come from the serving route
 * alone; see `migrations/0063_create_dashboard_texture.md`. Same split as
 * `Module.hasCarouselImage`.
 */
export interface DashboardTexture {
  hasImage: boolean;
  /** 0..1. Low by default — a picture behind text has to stay quiet. */
  opacity: number;
  mode: DashboardTextureMode;
  /** Gaussian blur in px, 0..40. 0 leaves the picture untouched. */
  blur: number;
  /**
   * When the row last changed, which is what makes it usable as the image URL's
   * cache-buster: the serving route sends a 5-minute max-age, so without it a
   * replaced picture would keep showing the old bytes.
   */
  updatedAt: string;
}

/** The knobs an admin can change without touching the picture itself. */
export type DashboardTextureSettings = Pick<DashboardTexture, "opacity" | "mode" | "blur">;
