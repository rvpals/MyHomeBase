// The use-cases for slot icon overrides: data in, data out, no I/O of its own.
//
// Overrides are keyed by (slot, set) rather than by slot alone. Switching icon sets
// therefore does not drag a custom glyph into a style it was never drawn for — an icon
// uploaded to sit among Solar Bold Duotone stays there, and Lucide shows Lucide. The cost
// is that re-skinning a slot in a second set is a second upload, which is the right way
// round: a set is a coherent look, and silently mixing one glyph into all thirteen would
// undermine the reason sets exist.

import { decodeImageUpload } from "@/lib/shared/image-upload";
import { sanitizeSvg } from "./sanitize-svg";
import {
  ICON_OVERRIDE_MAX_BYTES,
  clearIconOverrideSchema,
  iconOverrideInputSchema,
  type ClearIconOverrideInput,
  type IconOverrideInput,
} from "./schema";
import { getIconSlot } from "./slots";
import { normalizeIconImage } from "./normalize-image";
import type { IconImageProcessor, IconOverridesRepository } from "./ports";
import type { IconOverride, IconOverrideImage, IconOverrideMap } from "./types";

/**
 * The overrides for one set, keyed by slot id for O(1) lookup during render.
 *
 * Rows whose slot is no longer in the registry are dropped rather than returned. A slot
 * id can disappear when a feature is removed, and a stale row must not become a glyph
 * nothing can reach the UI to delete.
 */
export function getOverrideMap(repo: IconOverridesRepository, setId: string): IconOverrideMap {
  const map: IconOverrideMap = {};
  for (const override of repo.listForSet(setId)) {
    if (getIconSlot(override.slotId)) map[override.slotId] = override;
  }
  return map;
}

export function listOverrides(repo: IconOverridesRepository, setId: string): IconOverride[] {
  return repo.listForSet(setId).filter((override) => getIconSlot(override.slotId));
}

export function getOverrideImage(
  repo: IconOverridesRepository,
  slotId: string,
  setId: string,
): IconOverrideImage | undefined {
  if (!getIconSlot(slotId)) return undefined;
  return repo.getImage(slotId, setId);
}

/**
 * Stores an uploaded glyph for one slot, replacing whatever was there.
 *
 * The slot is checked against the code registry, not just the schema: `slotId` arrives
 * from a form post, and an unrecognised one would write a row that no screen can render
 * or remove. Rejecting it here keeps the table's contents a subset of `ICON_SLOTS`.
 */
export async function saveOverride(
  repo: IconOverridesRepository,
  input: IconOverrideInput,
  now: Date = new Date(),
  /**
   * Optional so tests and any caller that only handles SVG need not supply one. When it is
   * absent a raster upload is stored exactly as it arrived — the pre-processing behaviour.
   */
  processor?: IconImageProcessor,
): Promise<IconOverride> {
  const parsed = iconOverrideInputSchema.parse(input);

  if (!getIconSlot(parsed.slotId)) {
    throw new Error(`Unknown icon position: ${parsed.slotId}`);
  }

  const updatedAt = now.toISOString();

  if (parsed.kind === "svg") {
    const { body, width, height } = sanitizeSvg(parsed.source);
    repo.upsert({
      slotId: parsed.slotId,
      setId: parsed.setId,
      svgBody: body,
      svgWidth: width,
      svgHeight: height,
      updatedAt,
    });
    return {
      slotId: parsed.slotId,
      setId: parsed.setId,
      svgBody: body,
      svgWidth: width,
      svgHeight: height,
      updatedAt,
    };
  }

  const { data, mimeType } = decodeImageUpload(
    { mimeType: parsed.mimeType, base64Data: parsed.base64Data },
    ICON_OVERRIDE_MAX_BYTES,
  );

  // Normalise the raster: undo a flattened checkerboard, trim dead margin, downscale to
  // the stored size. Failure here is deliberately NOT fatal — a decoder that chokes on an
  // odd-but-valid file should cost the reader a less tidy icon, not their upload. The
  // original bytes already passed the mime allowlist and the size cap, so falling back to
  // them is safe.
  let storedData = data;
  let storedMime: string = mimeType;
  if (processor) {
    try {
      const normalized = await normalizeIconImage(processor, data);
      storedData = normalized.data;
      storedMime = normalized.mimeType;
    } catch (error) {
      // Two very different failures land here, and they deserve different answers.
      //
      // The processor being UNAVAILABLE — a native module that won't load on this
      // platform — is an install problem. Storing the raw upload anyway would "work"
      // while quietly producing exactly the muddy icon this pipeline exists to prevent,
      // and nothing would ever say why. So it propagates: one clear error beats a silent
      // downgrade repeated on every upload.
      //
      // A single image being UNREADABLE is the reader's problem, not the server's, and it
      // should not cost them the upload. The original bytes already passed the mime
      // allowlist and the size cap, so keeping them is safe.
      if (error instanceof Error && /Image processing is unavailable/.test(error.message)) {
        throw error;
      }
      // Keep `data`/`mimeType` as decoded.
    }
  }

  repo.upsert({
    slotId: parsed.slotId,
    setId: parsed.setId,
    imageData: storedData,
    imageMimeType: storedMime,
    updatedAt,
  });
  return { slotId: parsed.slotId, setId: parsed.setId, imageMimeType: storedMime, updatedAt };
}

/** Removes an override so the slot falls back to its set's own glyph. */
export function clearOverride(
  repo: IconOverridesRepository,
  input: ClearIconOverrideInput,
): void {
  const { slotId, setId } = clearIconOverrideSchema.parse(input);
  repo.remove(slotId, setId);
}
