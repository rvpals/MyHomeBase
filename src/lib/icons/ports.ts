import type { IconOverride, IconOverrideImage } from "./types";

/** One override on its way to storage. Bytes are already decoded and sanitized. */
export interface IconOverrideWrite {
  slotId: string;
  setId: string;
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  imageData?: Buffer;
  imageMimeType?: string;
  updatedAt: string;
}

// The use-cases depend on THIS interface, not on a concrete database.
export interface IconOverridesRepository {
  /**
   * Every override for one icon set, without the raster BLOBs.
   *
   * Read on every page render (the root layout hands the map to the provider), so it
   * must not drag image bytes along — the serving route fetches those one at a time.
   */
  listForSet(setId: string): IconOverride[];
  getImage(slotId: string, setId: string): IconOverrideImage | undefined;
  upsert(override: IconOverrideWrite): void;
  remove(slotId: string, setId: string): void;
}
