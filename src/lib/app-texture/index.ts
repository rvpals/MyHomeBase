// The public surface of this module.
//
// No repository to export: this module owns a precedence rule, not storage. The
// two textures it combines are read through their own modules' front doors and
// handed in, which is also what keeps it trivially testable — see
// `app-texture.test.ts`, which needs no fake repo at all.
export type { AppTextureSource, ResolvedAppTexture } from "./types";
export {
  homeDrawsOwnTexture,
  homeTexture,
  moduleTextureLibraryId,
  resolveAppTexture,
} from "./app-texture";
