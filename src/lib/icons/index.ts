export type {
  IconSlot,
  IconNamespace,
  IconOverride,
  IconOverrideImage,
  IconOverrideMap,
} from "./types";
export {
  ICON_SLOTS,
  getIconSlot,
  isIconSlotId,
  groupedIconSlots,
  sectionSlotId,
  tabSlotId,
} from "./slots";
export {
  iconOverrideInputSchema,
  clearIconOverrideSchema,
  ICON_OVERRIDE_MAX_BYTES,
  type IconOverrideInput,
  type ClearIconOverrideInput,
} from "./schema";
export type { IconOverridesRepository, IconOverrideWrite } from "./ports";
export {
  getOverrideMap,
  listOverrides,
  getOverrideImage,
  saveOverride,
  clearOverride,
} from "./overrides";
export { sanitizeSvg, type SanitizedSvg } from "./sanitize-svg";
export {
  normalizeIconImage,
  detectBackdropColours,
  findContentBox,
  ICON_TARGET_SIZE,
} from "./normalize-image";
export type { IconImageProcessor } from "./ports";
export type { NormalizedIcon, RawBitmap } from "./types";
