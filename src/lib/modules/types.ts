import type { ModuleIconName } from "./icon-names";

export interface Module {
  id: number;
  slug: string;
  shortName: string;
  longName: string;
  description?: string;
  sequence: number;
  isVisible: boolean;
  icon: ModuleIconName;
  /**
   * Whether a carousel image has been uploaded — **not the image itself**.
   *
   * Computed in SQL (`carousel_image IS NOT NULL`) so the home screen can decide
   * between the artwork and the glyph without any read of this table pulling a
   * megabyte of BLOB. `sys_modules` is read on every authenticated page; see
   * `migrations/0040_add_carousel_image_to_modules.md`.
   */
  hasCarouselImage: boolean;
  /**
   * When the row last changed. Bumped whenever the carousel image is replaced,
   * which is what makes it usable as the image URL's cache-buster — the serving
   * route sends a 5-minute max-age, so without it a replaced graphic would keep
   * showing the old bytes.
   *
   * Optional because `DEFAULT_MODULES` describes modules that don't exist yet.
   */
  updatedAt?: string;
}

/**
 * A module as *seed data* — what "Reset to Default" writes.
 *
 * Omits the fields that only exist once a row does: its id, whether artwork has
 * been uploaded, and when it last changed. Without this, `DEFAULT_MODULES` would
 * have to declare `hasCarouselImage: false` four times to say nothing.
 */
export type ModuleSeed = Omit<Module, "id" | "hasCarouselImage" | "updatedAt">;
