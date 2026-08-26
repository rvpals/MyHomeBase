// The public surface of this module.
//
// Deliberately does NOT re-export `SqliteDashboardTextureRepository`, unlike some
// other lib modules: the admin control is a client component and imports
// `MAX_DASHBOARD_TEXTURE_BYTES` and `DashboardTextureMode` from here, so a
// re-export would drag `better-sqlite3` into the browser bundle. `src/lib/wiring.ts`
// imports the concrete repository from "./dashboard-texture/repository" instead --
// the same split `src/lib/modules/index.ts` keeps, for the same reason.
export type {
  DashboardTexture,
  DashboardTextureMode,
  DashboardTextureSettings,
} from "./types";
export type { DashboardTextureRepository } from "./ports";
export { dashboardTextureSettingsSchema } from "./schema";
export type { DashboardTextureSettingsInput } from "./schema";
export {
  MAX_DASHBOARD_TEXTURE_BYTES,
  dashboardTextureCssVars,
  getDashboardTexture,
  getDashboardTextureImage,
  removeDashboardTextureImage,
  saveDashboardTextureSettings,
  setDashboardTextureImage,
} from "./dashboard-texture";
