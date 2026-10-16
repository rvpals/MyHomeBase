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
   * Whether an icon has been uploaded for this module — **not the artwork**.
   *
   * Same split as `hasCarouselImage`, and for the same reason: `sys_modules` is
   * read on every authenticated page, so the payload stays behind a dedicated
   * read. When true the module's `icon` name is not drawn; see
   * `migrations/0150_module_custom_icon.md`.
   */
  hasCustomIcon: boolean;
  /**
   * Which kind of upload it is, when there is one.
   *
   * `"svg"` is inlined as sanitized markup and tints with `currentColor`;
   * `"image"` is served by `/api/modules/<slug>/icon` and never tints. A
   * renderer needs to know which before it can choose an element, and this
   * costs nothing — both flags are computed in SQL alongside the carousel's.
   */
  customIconKind?: "svg" | "image";
  /**
   * When the row last changed. Bumped whenever the carousel image is replaced,
   * which is what makes it usable as the image URL's cache-buster — the serving
   * route sends a 5-minute max-age, so without it a replaced graphic would keep
   * showing the old bytes. A custom icon upload bumps it for the same reason,
   * and `/api/modules/<slug>/icon` is addressed with the same `?v=`.
   *
   * Optional because `DEFAULT_MODULES` describes modules that don't exist yet.
   */
  updatedAt?: string;
}

/**
 * A module as *seed data* — what "Reset to Default" writes.
 *
 * Omits the fields that only exist once a row does: its id, whether artwork or
 * a custom icon has been uploaded, and when it last changed. Without this,
 * `DEFAULT_MODULES` would have to declare `hasCarouselImage: false` four times
 * to say nothing.
 */
export type ModuleSeed = Omit<
  Module,
  "id" | "hasCarouselImage" | "hasCustomIcon" | "customIconKind" | "updatedAt"
>;

/**
 * A module's uploaded icon, payload included. Only the serving route and the
 * admin screen's preview ever hold one.
 *
 * Exactly one of the two payloads is present, mirroring `IconOverride` in
 * `src/lib/icons/types.ts`: SVG is a sanitized inner body so it can be inlined
 * and inherit `currentColor`, raster bytes are served by a route and can never
 * tint.
 */
export interface ModuleCustomIcon {
  /** Sanitized inner SVG markup — no outer <svg> element, no script, no external refs. */
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  data?: Buffer;
  mimeType?: string;
}

/**
 * One module's uploaded icon as the nav needs it: enough to render, with no
 * raster bytes.
 *
 * The summary/full-record split this codebase makes everywhere else. The full
 * record is `ModuleCustomIcon`, which the serving route reads one at a time;
 * this is the projection every page render gets for every module at once, so
 * the one thing it must never carry is a BLOB.
 */
export interface ModuleCustomIconSummary {
  slug: string;
  kind: "svg" | "image";
  /** Sanitized inner markup. Present only for `kind: "svg"`. */
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  /** The module's `updatedAt`, used as the image URL's `?v=` cache-buster. */
  version?: string;
}
