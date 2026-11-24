// The front door of the Code Library module.
//
// Everything outside this folder imports from here and nowhere else —
// `ARCHITECTURE.md` → *Modules*. Reaching into `./repository` or `./code-library`
// from a view or an action is the import that makes a module impossible to move
// later.

export type {
  RecycledSnippet,
  Snippet,
  SnippetSummary,
  SnippetTaxonomyItem,
} from "./types";

export type { CodeLibraryRepository } from "./ports";

export {
  DEFAULT_SNIPPET_LANGUAGE,
  SNIPPET_CODE_MAX_LENGTH,
  SNIPPET_CARD_COLORS,
  SNIPPET_LANGUAGES,
  SNIPPET_LANGUAGE_LABELS,
  SNIPPET_PREVIEW_LINES,
  SNIPPET_TITLE_MAX_LENGTH,
  SNIPPET_NOTES_MAX_LENGTH,
  colorSnippetSchema,
  createSnippetSchema,
  encryptSnippetSchema,
  pinSnippetSchema,
  snippetFilterSchema,
  snippetLanguageSchema,
  snippetCardColorSchema,
  snippetPasswordSchema,
  snippetTaxonomyNameSchema,
  snippetTaxonomyWriteSchema,
  toSnippetLanguage,
  updateSnippetSchema,
  type ColorSnippetInput,
  type CreateSnippetData,
  type CreateSnippetInput,
  type EncryptSnippetInput,
  type PinSnippetInput,
  type SnippetFilterInput,
  type SnippetCardColor,
  type SnippetLanguage,
  type SnippetPasswordInput,
  type SnippetTaxonomyWriteInput,
  type UpdateSnippetData,
  type UpdateSnippetInput,
} from "./schema";

export {
  SnippetNotFoundError,
  createSnippet,
  decryptSnippet,
  deleteSnippetCategory,
  deleteSnippetTag,
  emptyRecycleBin,
  encryptSnippet,
  getSnippet,
  listRecycledSnippets,
  listSnippetCategories,
  listSnippetTags,
  listSnippets,
  openSnippet,
  purgeRecycledSnippet,
  recycleSnippet,
  restoreRecycledSnippet,
  saveSnippetCategory,
  saveSnippetTag,
  setSnippetColor,
  setSnippetPinned,
  updateSnippet,
} from "./code-library";

export { highlightCode, type CodeToken, type CodeTokenKind } from "./highlight";

export { dealIntoColumns, estimateSnippetCardHeight } from "./board";

export { SqliteCodeLibraryRepository } from "./repository";
