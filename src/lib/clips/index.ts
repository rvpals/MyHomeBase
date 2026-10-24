// The front door of the Clips module.
//
// Everything outside this folder imports from here and nowhere else —
// `ARCHITECTURE.md` → *Modules*. Reaching into `./repository` or `./clips` from a
// view or an action is the import that makes a module impossible to move later.

export type {
  Clip,
  ClipImage,
  ClipLink,
  ClipLinkModule,
  ClipSummary,
  ClipTaxonomyItem,
  ResolvedClipLink,
} from "./types";

export type { ClipImageProcessor, ClipsRepository, ClipWriteData } from "./ports";

export {
  CLIP_CONTENT_MAX_LENGTH,
  CLIP_IMAGE_MAX_BYTES,
  CLIP_IMAGE_MAX_EDGE,
  CLIP_LINK_MODULES,
  CLIP_MAX_IMAGES,
  CLIP_TITLE_MAX_LENGTH,
  clipFilterSchema,
  clipImageUploadSchema,
  clipLinkModuleSchema,
  clipPasswordSchema,
  clipTaxonomySchema,
  createClipSchema,
  encryptClipSchema,
  linkClipSchema,
  unlinkClipSchema,
  updateClipSchema,
} from "./schema";

export type {
  ClipFilterInput,
  ClipImageUploadInput,
  ClipPasswordInput,
  ClipTaxonomyInput,
  CreateClipInput,
  EncryptClipInput,
  LinkClipInput,
  UnlinkClipInput,
  UpdateClipInput,
} from "./schema";

export {
  ClipIsEncryptedError,
  ClipNotFoundError,
  TooManyClipImagesError,
  addClipImage,
  countClipsForTargets,
  createClip,
  decryptClip,
  deleteClip,
  deleteClipCategory,
  deleteClipImage,
  deleteClipTag,
  encryptClip,
  getClip,
  linkClip,
  listClipCategories,
  listClips,
  listClipsForTarget,
  listClipTags,
  openClip,
  saveClipCategory,
  saveClipTag,
  toClipSummary,
  unlinkClip,
  updateClip,
  type ClipWriteResult,
} from "./clips";

// The sanitiser is exported because the editor needs the *same* pass the use-case
// runs, so what a reader sees after pasting is what will be stored. Running a
// different cleanup in the browser would mean the preview and the saved clip
// could disagree.
export {
  buildClipExcerpt,
  clipHtmlToText,
  sanitizeClipHtml,
  type SanitizeHtmlResult,
} from "./sanitize-html";

export { SqliteClipsRepository } from "./repository";
export { SharpClipImageProcessor } from "./image-processor";

// Re-exported so an action can tell "that password is wrong" from a genuine
// failure. The implementation is shared with the Journal — see
// `@/lib/shared/encryption`.
export { MalformedCipherTextError, WrongPasswordError } from "@/lib/shared/encryption";
