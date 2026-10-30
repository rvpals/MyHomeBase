// The front door of the Document Library module.
//
// Everything outside this folder imports from here and nowhere else —
// `ARCHITECTURE.md` → *Modules*. Reaching into `./repository` or `./documents` from a
// view or an action is the import that makes a module impossible to move later.

export type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
  DocumentWithAttachments,
  DuplicateMatch,
  RecycledDocument,
} from "./types";

export type {
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
  documentTaxonomySchema,
  formatBytes,
  removeAttachmentSchema,
  updateDocumentSchema,
  type AttachmentUploadInput,
  type CreateDocumentInput,
  type DeleteDocumentInput,
  type DocumentFilterInput,
  type DocumentTaxonomyInput,
  type RemoveAttachmentInput,
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

export {
  NodeDocumentFileStore,
  resolveInside,
  type DocumentFileStore,
  type DocumentRootCheck,
  type FolderListing,
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
  type DocumentLimits,
  type DocumentSettings,
} from "./settings";
