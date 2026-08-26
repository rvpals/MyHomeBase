// The public surface of this module.
//
// Deliberately does NOT re-export `SqliteModuleTextureRepository`: the module's
// texture control is a client component and imports `MAX_MODULE_TEXTURE_BYTES`
// and `ModuleTextureMode` from here, so a re-export would drag `better-sqlite3`
// into the browser bundle. `src/lib/wiring.ts` imports the concrete repository
// from "./module-texture/repository" instead -- the same split
// `src/lib/dashboard-texture/index.ts` and `src/lib/modules/index.ts` keep, for
// the same reason.
export type { ModuleTexture, ModuleTextureMode, ModuleTextureSettings } from "./types";
export type { ModuleTextureRepository } from "./ports";
export { moduleTextureSettingsSchema, moduleTextureSlugSchema } from "./schema";
export type { ModuleTextureSettingsInput } from "./schema";
export {
  MAX_MODULE_TEXTURE_BYTES,
  getModuleTexture,
  getModuleTextureImage,
  moduleTextureCssVars,
  removeModuleTextureImage,
  saveModuleTextureSettings,
  setModuleTextureImage,
} from "./module-texture";
