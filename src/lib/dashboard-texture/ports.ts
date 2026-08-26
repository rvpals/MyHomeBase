import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DashboardTexture, DashboardTextureSettings } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface DashboardTextureRepository {
  /**
   * The settings row. **Never includes the image bytes** — the domain type
   * carries only `hasImage`, so this read is safe on a hot path.
   */
  getTexture(): DashboardTexture;

  /**
   * The picture's bytes. **The only read that touches the BLOB** — call it from
   * the serving route and nowhere else, or the bytes end up in a page render.
   */
  getTextureImage(): DecodedImage | undefined;

  /** Replaces the picture, or clears it when given `undefined`. */
  setImage(image: DecodedImage | undefined): void;

  /** Updates the display knobs, leaving the picture alone. */
  setSettings(settings: DashboardTextureSettings): void;
}
