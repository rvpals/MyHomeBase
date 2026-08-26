/** How a texture picture is laid out behind a module's screens. */
export type ModuleTextureMode = "cover" | "tile";

/**
 * A module's texture settings — **never the image bytes**.
 *
 * `hasImage` is computed in SQL (`image IS NOT NULL`) so a module shell can decide
 * whether to emit a texture layer at all without any read pulling a multi-megabyte
 * BLOB into a page render. The bytes come from the serving route alone; see
 * `migrations/0064_create_module_texture.md`. Same split as `Module.hasCarouselImage`
 * and `DashboardTexture.hasImage`.
 */
export interface ModuleTexture {
  /** The module this belongs to, e.g. `'music-library'`. */
  moduleSlug: string;
  hasImage: boolean;
  /** 0..1. Low by default — a picture behind text has to stay quiet. */
  opacity: number;
  mode: ModuleTextureMode;
  /** Gaussian blur in px, 0..40. 0 leaves the picture untouched. */
  blur: number;
  /**
   * When the row last changed, which is what makes it usable as the image URL's
   * cache-buster: the serving route sends a 5-minute max-age, so without it a
   * replaced picture would keep showing the old bytes. `''` when there is no row.
   */
  updatedAt: string;
}

/** The knobs an admin can change without touching the picture itself. */
export type ModuleTextureSettings = Pick<ModuleTexture, "opacity" | "mode" | "blur">;
