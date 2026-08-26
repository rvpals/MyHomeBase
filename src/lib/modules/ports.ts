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
}
