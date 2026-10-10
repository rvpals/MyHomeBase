// The public surface of this module.
//
// No repository to export: like `app-texture`, this module owns a resolution
// rule rather than storage. The two settings rows are read through `settings`'
// own front door and the pictures through `dashboard-texture`'s, then handed in
// — which is also what keeps it testable with no fake repo at all.
export type { NavTextureSettings, ResolvedNavTexture } from "./types";
export {
  DEFAULT_NAV_TEXTURE_OPACITY,
  NAV_TEXTURE_ID_KEY,
  NAV_TEXTURE_OPACITY_KEY,
  navTextureVars,
  NO_NAV_TEXTURE,
  resolveNavTexture,
  resolveNavTextureOpacity,
} from "./nav-texture";
