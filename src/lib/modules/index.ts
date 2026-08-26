export type { Module } from "./types";
export { MODULE_ICON_NAMES, type ModuleIconName } from "./icon-names";
export {
  MAX_CAROUSEL_IMAGE_BYTES,
  moduleIconNameSchema,
  moduleSchema,
  moduleUpdateSchema,
  type ModuleInput,
  type ModuleUpdate,
} from "./schema";
export type { ModuleRepository } from "./ports";
export {
  listModules,
  getModuleBySlug,
  updateModules,
  resetModulesToDefaults,
  setModuleIcon,
  setModuleCarouselImage,
  removeModuleCarouselImage,
  getModuleCarouselImage,
} from "./modules";
