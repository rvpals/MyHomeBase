import type { DecodedImage } from "@/lib/shared/image-upload";
import type {
  ModuleTexture,
  ModuleTextureSettings,
  ModuleTextureSource,
} from "./types";

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

  /**
   * The slugs of every module that does **not** inherit the app-wide texture —
   * because it draws its own picture, a library one, or nothing at all.
   *
   * Exists for the app-wide texture screen (0116), which tells the admin which
   * modules will ignore the app background rather than leaving them to discover
   * it one screen at a time. Slugs only — no settings and certainly no bytes.
   */
  listSlugsWithImage(): string[];

  /**
   * Sets which of the four sources a module draws (migration 0117).
   *
   * Leaves any uploaded `image` in place, so a module that switches to a library
   * picture and back again keeps its own without a re-upload.
   */
  setChoice(moduleSlug: string, source: ModuleTextureSource, textureId?: number): void;
}
