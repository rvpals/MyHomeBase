export type { Module, ModuleCustomIcon, ModuleCustomIconSummary } from "./types";
export { MODULE_ICON_NAMES, type ModuleIconName } from "./icon-names";
export {
  MAX_CAROUSEL_IMAGE_BYTES,
  MAX_MODULE_ICON_BYTES,
  moduleCustomIconInputSchema,
  moduleIconNameSchema,
  moduleSchema,
  moduleUpdateSchema,
  type ModuleCustomIconInput,
  type ModuleInput,
  type ModuleUpdate,
} from "./schema";
export type { CarouselImageProcessor, ModuleRepository } from "./ports";
export {
  CAROUSEL_IMAGE_MAX_EDGE,
  CAROUSEL_IMAGE_WEBP_QUALITY,
  resizeCarouselImage,
  type ResizeCarouselImageResult,
} from "./resize-carousel-image";
export {
  listModules,
  getModuleBySlug,
  updateModules,
  resetModulesToDefaults,
  setModuleIcon,
  setModuleCarouselImage,
  removeModuleCarouselImage,
  getModuleCarouselImage,
  setModuleCustomIcon,
  removeModuleCustomIcon,
  getModuleCustomIcon,
  getModuleCustomIconMap,
} from "./modules";
