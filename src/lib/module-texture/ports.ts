import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleTexture, ModuleTextureSettings } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface ModuleTextureRepository {
  /**
   * One module's settings row. **Never includes the image bytes** — the domain
   * type carries only `hasImage`, so this read is safe on a page render.
   * Returns the display defaults when the module has no row.
   */
  getTexture(moduleSlug: string): ModuleTexture;

  /**
   * The picture's bytes. **The only read that touches the BLOB** — call it from
   * the serving route and nowhere else, or the bytes end up in a page render.
   */
  getTextureImage(moduleSlug: string): DecodedImage | undefined;

  /** Replaces the picture, or clears it when given `undefined`. */
  setImage(moduleSlug: string, image: DecodedImage | undefined): void;

  /** Updates the display knobs, leaving the picture alone. */
  setSettings(moduleSlug: string, settings: ModuleTextureSettings): void;
}
