import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleIconName } from "./icon-names";
import type { ModuleUpdate } from "./schema";
import type { Module, ModuleSeed } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface ModuleRepository {
  /** Never includes image bytes — `Module` carries only `hasCarouselImage`. */
  listModules(options?: { includeHidden?: boolean }): Module[];
  getModuleBySlug(slug: string): Module | undefined;
  /** Updates each module's editable fields and reassigns sequence by array order. */
  updateAll(updates: ModuleUpdate[]): void;
  /** Replaces the entire table with the given rows (sequence = array order). */
  resetToDefaults(defaults: ModuleSeed[]): void;
  /**
   * Sets one module's glyph on its own.
   *
   * Separate from `updateAll` because the icon picker saves on pick rather than
   * through the admin form's Save button — see `setModuleIcon`.
   */
  setIcon(slug: string, icon: ModuleIconName): void;

  /**
   * The carousel image bytes. **The only read that touches the BLOB** — call it
   * from the serving route and nowhere else, or the bytes end up in a page.
   */
  getCarouselImage(slug: string): DecodedImage | undefined;
  /** Replaces the image, or clears it when given `undefined`. */
  setCarouselImage(slug: string, image: DecodedImage | undefined): void;
  /**
   * Every stored carousel image, bytes included. **For the resize backfill CLI
   * only** — like `getCarouselImage`, this reads the BLOB, so anything that
   * renders a list must keep using `listModules`.
   */
  listAllCarouselImages(): { slug: string; data: Buffer; mimeType: string }[];
}

/**
 * Pixel work, behind a port.
 *
 * Same split as `IconImageProcessor`: `src/lib/` may not import `sharp` (it is a
 * native module, and a use-case that reaches for one can't be tested without
 * it), so the *decisions* — is this worth resizing? what does it become? — live
 * in `resize-carousel-image.ts` as plain arithmetic, and only the decode/encode
 * crosses this line.
 */
export interface CarouselImageProcessor {
  /** Pixel dimensions, without decoding the whole bitmap. Throws if unreadable. */
  probe(data: Buffer): Promise<{ width: number; height: number }>;
  /**
   * Re-encodes as WebP, scaled so it fits inside `maxEdge` square.
   *
   * Must never upscale and never crop: this is somebody's artwork, and a
   * graphic that arrives smaller than the target is already fine as it is.
   */
  encodeWebp(data: Buffer, maxEdge: number, quality: number): Promise<Buffer>;
}
