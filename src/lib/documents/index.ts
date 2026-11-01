// The front door of the Document Library module.
//
// Everything outside this folder imports from here and nowhere else —
// `ARCHITECTURE.md` → *Modules*. Reaching into `./repository` or `./documents` from a
// view or an action is the import that makes a module impossible to move later.

export type {
  AttachmentText,
  AttachmentTextSearchHit,
  AttachmentTextSource,
  AttachmentTextStatus,
  AttachmentTextSummary,
  Document,
  DocumentAttachment,
  DocumentPrefillField,
  DocumentPrefillFieldValue,
  DocumentPrefillFormValues,
  DocumentPrefillMode,
  DocumentPrefillTemplate,
  DocumentSummary,
  DocumentTaxonomyItem,
  DocumentWithAttachments,
  DuplicateMatch,
  RecycledDocument,
} from "./types";

export type {
  AttachmentTextWriteData,
  AttachmentWriteData,
  BulkTaxonomyMode,
  DocumentsRepository,
  DocumentWriteData,
} from "./ports";

export {
  DEFAULT_DOCUMENT_MAX_FILES,
  DEFAULT_DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_DESCRIPTION_MAX_LENGTH,
  DOCUMENT_MAX_FILES_CEILING,
  DOCUMENT_MAX_FILE_BYTES_CEILING,
  DOCUMENT_TITLE_MAX_LENGTH,
  attachmentUploadSchema,
  createDocumentSchema,
  deleteDocumentSchema,
  documentFilterSchema,
  documentPrefillFieldSchema,
  documentPrefillFieldValueSchema,
  documentPrefillModeSchema,
  documentTaxonomySchema,
  formatBytes,
  parseStoredDocumentPrefillFields,
  removeAttachmentSchema,
  saveDocumentPrefillTemplateSchema,
  updateDocumentSchema,
  type AttachmentUploadInput,
  type CreateDocumentInput,
  type DeleteDocumentInput,
  type DocumentFilterInput,
  type DocumentPrefillTemplateWriteData,
  type DocumentTaxonomyInput,
  type RemoveAttachmentInput,
  type SaveDocumentPrefillTemplateInput,
  type UpdateDocumentInput,
} from "./schema";

export {
  DELETED_FOLDER,
  DEFAULT_MIME_TYPE,
  buildAttachmentPath,
  deletedDocumentFolder,
  documentFolder,
  isInlineRenderable,
  mimeTypeFor,
  sanitizeFileName,
  sanitizeNameSegment,
  withCollisionSuffix,
} from "./attachment-path";

// Types only, matching the music barrel. `file-store.ts` imports `node:fs/promises`,
// and ANY value re-export from it — the class or the pure `resolveInside` helper alike,
// since they share the module — drags that into the client bundle of every component
// that touches this barrel, failing the production build ("the chunking context does
// not support external modules"). A `export type` erases at compile time and is safe.
//
// The values live one import away, and their only real consumers already reach for
// them there: `wiring.ts` for the store, `file-store.test.ts` for the helper.
//
//   import { NodeDocumentFileStore, resolveInside } from "@/lib/documents/file-store";
export type {
  DocumentFileStore,
  DocumentRootCheck,
  FolderListing,
} from "./file-store";

export { SqliteDocumentsRepository } from "./repository";

export {
  MAX_DOCUMENT_ICON_BYTES,
  addAttachment,
  buildDocumentArchive,
  clearCategoryIcon,
  clearTagIcon,
  createDocument,
  deleteCategory,
  deleteDocument,
  deleteTag,
  getCategoryIcon,
  getDocument,
  getTagIcon,
  listAttachmentsFor,
  listCategories,
  listDocuments,
  listTags,
  readAttachment,
  removeAttachment,
  saveCategory,
  saveTag,
  setCategoryIcon,
  setTagIcon,
  updateDocument,
  type AddAttachmentResult,
  type DocumentFiles,
  type DocumentLimitsInput,
} from "./documents";

// Content hashes, duplicate detection, bulk edits and the recycle bin (migration 0163).
export {
  UNHASHED,
  findDuplicates,
  hashAndFindDuplicates,
  hashContent,
  isHashed,
} from "./content-hash";

export {
  BULK_TAXONOMY_MODES,
  bulkSetTaxonomy,
  bulkTaxonomySchema,
  describeBulkResult,
  type BulkTaxonomyInput,
  type BulkTaxonomyResult,
} from "./bulk";

// `deleteDocument` above is now the permanent purge — the Delete button calls
// `recycleDocuments`, and only the bin's own purge removes a document's index.
export {
  countRecycledDocuments,
  deleteRecycledDocumentsForever,
  emptyDocumentsRecycleBin,
  listRecycledDocuments,
  recycleDocuments,
  restoreRecycledDocuments,
  restoredFolderFor,
  type DocumentPurgeResult,
  type DocumentRecycleResult,
  type DocumentRestoreResult,
} from "./recycle";

// The tree view's shaping (categories, the tags in use under each). Pure functions
// over rows the caller already read — no repository, so a CLI can build the same tree.
export {
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL,
  attachTagIcons,
  buildDocumentTree,
  isInTreeSelection,
  treeSelectionFilter,
  type DocumentTreeCategory,
  type DocumentTreeTag,
} from "./tree";

export {
  DOCUMENTS_MODULE_SLUG,
  DOCUMENT_SETTING_KEYS,
  describeDocumentRootCheck,
  documentRootSchema,
  getDocumentLimits,
  getDocumentSettings,
  resolveDocumentLimits,
  resolveDocumentSettings,
  setDocumentRoot,
  setKeywordIgnored,
  type DocumentLimits,
  type DocumentSettings,
} from "./settings";

// Extracted text, OCR and full-text search (migration 0165).
//
// `nodeTextExtractionEngines` is exported from here but reaches `unpdf`,
// `tesseract.js` and `@napi-rs/canvas` only through lazy `await import()`s — naming it
// costs nothing, and no page that does not run an extraction ever loads them.
export {
  MIN_TEXT_LAYER_CHARS,
  extractText,
  extractTextWithOcr,
  formatElapsed,
  normaliseExtractedText,
  type TextExtractionEngines,
  type TextExtractionResult,
  type TextExtractionSource,
  type TextExtractionStatus,
} from "./text-extract";

export {
  OCR_PAGE_LIMIT,
  OCR_RENDER_DPI,
  nodeTextExtractionEngines,
} from "./text-engines";

export {
  extractAttachmentText,
  extractDocumentText,
  findDocumentIdsByContent,
  forgetAttachmentText,
  getAttachmentText,
  listDocumentText,
  searchDocumentText,
  describeTextIndexPass,
  runTextIndexPass,
  summariseExtraction,
  type ExtractionRunResult,
  type TextIndexDeps,
  type TextIndexPassResult,
} from "./text-index";

// The Keywords section: what words the library contains, ranked, and the documents
// behind one of them. Reads the text index rather than owning a table — see the note
// at the top of `keywords.ts` for why there is no `doc_keywords`.
export {
  DEFAULT_KEYWORD_LIMIT,
  KEYWORD_SCAN_LIMIT,
  findDocumentsForKeyword,
  rankDocumentKeywords,
  type DocumentKeyword,
  type KeywordRanking,
  type KeywordRankingOptions,
} from "./keywords";

// The background indexing job (migration 0166): its settings, cadence and runner.
//
// `text-index-runner` is NOT re-exported here. It imports `@/lib/wiring`, so pulling
// it through the barrel would drag the composition root into every importer — the
// scheduler and the CLI reach it by its own path instead.
export {
  DEFAULT_TEXT_INDEX_BATCH,
  DEFAULT_TEXT_INDEX_ENABLED,
  DEFAULT_TEXT_INDEX_INTERVAL_HOURS,
  DEFAULT_TEXT_INDEX_OCR,
  TEXT_INDEX_SETTING_KEYS,
  TEXT_INDEX_SETTING_KEY_LIST,
  describeTextIndexInterval,
  isTextIndexJobEnabled,
  isTextIndexPassDue,
  resolveTextIndexJobSettings,
  type TextIndexJobSettings,
} from "./text-index-job";

// Prefill templates (migration 0169): a named set of field values a new document can
// be filed from. The apply step is pure, so the same merge runs in the New Document
// form, in the CLI's `documents-templates apply`, and in a test.
export {
  DOCUMENT_PREFILL_FIELDS,
  DOCUMENT_PREFILL_SUGGESTION_LIMIT,
  applyPrefillTemplate,
  deletePrefillTemplate,
  describePrefillFields,
  documentPrefillFieldIsList,
  documentPrefillFieldLabel,
  documentPrefillFieldSuggests,
  emptyPrefillValues,
  formStateToPrefillValues,
  getPrefillTemplate,
  getPrefillTemplateByName,
  joinPrefillList,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  prefillValuesToFormState,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  splitPrefillList,
  type DocumentPrefillFormState,
} from "./prefill";
