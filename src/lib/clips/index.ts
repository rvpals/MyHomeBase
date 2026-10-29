// The front door of the Clips module.
//
// Everything outside this folder imports from here and nowhere else —
// `ARCHITECTURE.md` → *Modules*. Reaching into `./repository` or `./clips` from a
// view or an action is the import that makes a module impossible to move later.

export type {
  Clip,
  ClipImage,
  ClipItem,
  ClipLink,
  ClipLinkModule,
  ClipSummary,
  ClipTaxonomyItem,
  RecycledClip,
  ResolvedClipLink,
} from "./types";

export type {
  ClipImageProcessor,
  ClipItemWriteData,
  ClipsRepository,
  ClipWriteData,
} from "./ports";

export {
  CLIP_CARD_COLORS,
  CLIP_CONTENT_MAX_LENGTH,
  CLIP_IMAGE_MAX_BYTES,
  CLIP_IMAGE_MAX_EDGE,
  CLIP_ITEM_MAX_LENGTH,
  CLIP_LINK_MODULES,
  CLIP_MAX_IMAGES,
  CLIP_MAX_ITEMS,
  CLIP_TITLE_MAX_LENGTH,
  clipCardColorSchema,
  clipFilterSchema,
  clipImageUploadSchema,
  clipLinkModuleSchema,
  clipPasswordSchema,
  clipTaxonomySchema,
  createClipSchema,
  encryptClipSchema,
  linkClipSchema,
  pinClipSchema,
  saveClipItemsSchema,
  setClipColorSchema,
  toggleClipItemSchema,
  unlinkClipSchema,
  updateClipSchema,
} from "./schema";

export type {
  ClipCardColor,
  ClipFilterInput,
  ClipImageUploadInput,
  ClipPasswordInput,
  ClipTaxonomyInput,
  CreateClipInput,
  EncryptClipInput,
  LinkClipInput,
  PinClipInput,
  SaveClipItemsInput,
  SetClipColorInput,
  ToggleClipItemInput,
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
  listClipItems,
  listClips,
  listClipsForTarget,
  listClipTags,
  openClip,
  saveClipCategory,
  saveClipItems,
  saveClipTag,
  setClipColor,
  setClipPinned,
  toClipSummary,
  toggleClipItem,
  unlinkClip,
  updateClip,
  type ClipWriteResult,
} from "./clips";

// The recycle bin (migration 0161). `deleteClip` above is now the permanent
// purge — the Delete button calls `recycleClips`, and only the bin's own purge
// and the CLI's `--forever` destroy anything.
export {
  countRecycledClips,
  deleteRecycledClipsForever,
  emptyClipsRecycleBin,
  listRecycledClips,
  recycleClips,
  restoreRecycledClips,
  type ClipPurgeResult,
  type ClipRecycleResult,
  type ClipRestoreResult,
} from "./recycle";

// The board's arrangement rules — pure, and shared by the board view, the list's
// pinned band and anything that needs the same split without a browser.
export {
  buildClipBoard,
  buildClipItemBoard,
  dealClipsIntoColumns,
  type ClipBoard,
  type ClipItemBoard,
} from "./board";

// The module's own settings, on `sys_module_settings` — no migration needed to add
// one. See `settings.ts` for why the excerpt ceiling is pinned to the repository's
// bounded-prefix read.
export {
  CLIPS_MODULE_SLUG,
  CLIPS_SETTING_KEYS,
  DEFAULT_CLIP_EXCERPT_CHARS,
  MAX_CLIP_EXCERPT_CHARS,
  MIN_CLIP_EXCERPT_CHARS,
  clipExcerptCharsSchema,
  getClipsSettings,
  resolveClipsSettings,
  setClipExcerptChars,
  type ClipsSettings,
} from "./settings";

// The sanitiser is exported because the editor needs the *same* pass the use-case
// runs, so what a reader sees after pasting is what will be stored. Running a
// different cleanup in the browser would mean the preview and the saved clip
// could disagree.
export {
  CLIP_EXCERPT_LENGTH,
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
