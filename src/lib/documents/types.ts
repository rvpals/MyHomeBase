// Domain types for the Document Library: a filed document with its taxonomy and the
// attachment files kept for it on the NAS.
//
// No zod here and no SQL — `schema.ts` validates boundary input, `repository.ts` talks
// to the database, and these are the shapes everything else passes around.

/**
 * One document, in full.
 *
 * Documents are **shared**: everyone granted the module sees every document, exactly
 * as a clip or an HSA expense is (`clp_clips.created_by`, migration 0155). `createdBy`
 * is attribution for the household, never a permission check — nothing filters on it.
 */
export interface Document {
  id: number;
  title: string;
  /** Free text. Blank, never null, so no reader handles two kinds of nothing. */
  description: string;
  categories: string[];
  tags: string[];
  /** Who filed it, or `null` once that account is gone. Attribution only. */
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A document as a list row.
 *
 * A deliberate projection rather than a trimmed `Document` — the same distinction
 * `ClipSummary` draws. The list carries the attachment *count* and total size, which
 * are one aggregate query, instead of every attachment row: a screen showing 200
 * documents should not pull 600 file records with it. Anything editing a document
 * fetches the full record and its attachments instead.
 */
/** What a list row can say about a document's recovered text. See `textState`. */
export type DocumentTextState = "none" | "text-layer" | "ocr";

export interface DocumentSummary {
  id: number;
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  /** How many files are attached. */
  attachmentCount: number;
  /** The sum of their `byteSize`, for a "how big is this" column. */
  totalBytes: number;
  /**
   * What the list can say about this document's text, in one word (migration 0166).
   *
   * A projection of its attachments' extraction rows, not a stored column:
   *
   *   `none`       — nothing readable has been recovered yet
   *   `text-layer` — every file that yielded text did so exactly
   *   `ocr`        — at least one file was read by recognition
   *
   * `ocr` wins over `text-layer` when a document holds both, because it is the
   * weaker claim: a reader deciding whether to trust a search hit needs to know that
   * *some* of this document's text was guessed at, and a badge saying "exact" over a
   * document that is half OCR would be the wrong reassurance.
   */
  textState: DocumentTextState;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One attached file, as the database indexes it.
 *
 * **The bytes are not here and never are.** The file lives on the configured share at
 * `relativePath`; this row is the index to it. That is the whole reason the module
 * takes a folder rather than storing BLOBs: a scanned lease is megabytes, and migration
 * 0079 already recorded what putting file bytes inline costs when it dropped
 * `jrn_entry_images`.
 */
export interface DocumentAttachment {
  id: number;
  documentId: number;
  /**
   * The name as stored on disk, after sanitising and any collision suffix —
   * `lease-2026.pdf`. This is the last segment of `relativePath`.
   */
  fileName: string;
  /**
   * The name the file arrived with, kept verbatim for display and for the download
   * filename. A reader recognises "Scan 12-03.pdf"; they do not recognise
   * "scan-12-03.pdf" as a different file, but they do notice it changed.
   */
  originalName: string;
  /**
   * Where the file sits **relative to the configured root**, forward slashes always:
   * `doc_17/lease-2026.pdf`.
   *
   * Relative, not absolute, for the reason the HSA receipts are: pointing the setting
   * at a copy of the folder keeps every stored path working. It is also the string
   * that gets resolved through `resolveInside`, which is what stops a crafted value
   * reaching the rest of the share.
   */
  relativePath: string;
  mimeType: string;
  byteSize: number;
  /**
   * SHA-256 of the file's bytes, lowercase hex, or `""` for a row that was never
   * hashed (migration 0163 added the column and did not backfill — see `UNHASHED`
   * in `content-hash.ts`). An un-hashed row takes no part in duplicate detection.
   */
  contentHash: string;
  sortOrder: number;
  createdAt: string;
}

/** A document with its attachments, which is what an editor and a viewer both need. */
export interface DocumentWithAttachments {
  document: Document;
  attachments: DocumentAttachment[];
}

/**
 * A category or a tag.
 *
 * Two lists on purpose, mirroring the Journal and Clips: a category says what KIND of
 * document this is (Insurance, Warranty, Tax), a tag says what it is ABOUT.
 *
 * `hasIcon` is derived in SQL as `icon_image IS NOT NULL` — the bytes themselves are
 * served by a route and must never ride along in a list payload.
 */
export interface DocumentTaxonomyItem {
  name: string;
  description: string;
  hasIcon: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One existing attachment that holds the same bytes as the file being uploaded
 * (migration 0163).
 *
 * Carries the document's title, not just its id, because the only useful phrasing of
 * this warning names it — "already attached to **Lease 2026**". An id would make the
 * reader go and look it up to decide whether they care.
 */
export interface DuplicateMatch {
  attachmentId: number;
  documentId: number;
  /** The document the matching file is attached to, for the warning's wording. */
  documentTitle: string;
  /** What the matching file is called there, which is usually the thing that differs. */
  originalName: string;
}

/**
 * A document sitting in the recycle bin (migration 0163).
 *
 * **`recycledId` is the handle**, not `id`. `id` is the id the document *had* when it
 * was live, kept because a restore aims to put it back there — and for a document
 * that matters more than it does for a clip, since every attachment path encodes it
 * (`doc_17/lease.pdf`). Restore, purge and the list all key on `recycledId`; passing
 * `id` to any of them would act on the wrong row or none at all.
 */
export interface RecycledDocument {
  /** This bin row's own id. The handle for restore and purge. */
  recycledId: number;
  /** The id it had while live, and the one a restore aims to put it back at. */
  id: number;
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  /** How many files came with it, mirroring `DocumentSummary`. */
  attachmentCount: number;
  totalBytes: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  /** When it went into the bin — the list's sort order. */
  deletedAt: string;
  /**
   * The stamped `_deleted/doc_17_<timestamp>` folder its files were moved to, or `""`
   * when it had no files.
   *
   * Stored rather than derived because `moveToDeleted` generates that timestamp at the
   * moment of the move and records it nowhere else; with two deletes of the same
   * document in the bin, guessing which folder belongs to which row would be a coin
   * flip. See migration 0163.
   */
  deletedFolder: string;
}

// ---------------------------------------------------------------------------
// Extracted text and search (migration 0165)
// ---------------------------------------------------------------------------

/** How the text was recovered: exactly, or by reading a picture of the words. */
export type AttachmentTextSource = "text-layer" | "ocr";

/** What happened when the file was read. Mirrors `TextExtractionStatus`. */
export type AttachmentTextStatus = "extracted" | "needs-ocr" | "unsupported" | "failed";

/**
 * One attachment's recovered text, as stored.
 *
 * The full record, carrying `body`. A list screen that only needs to know *whether* a
 * file has been read takes `AttachmentTextSummary` instead — the same deliberate
 * projection `DocumentSummary` is to `Document`, and for the same reason: a library of
 * 200 documents should not drag every extracted page into a render.
 */
export interface AttachmentText {
  attachmentId: number;
  documentId: number;
  /** The recovered text, already normalised. `""` for every status but `extracted`. */
  body: string;
  status: AttachmentTextStatus;
  source: AttachmentTextSource;
  pageCount: number;
  charCount: number;
  /** OCR's 0-100 self-report, or `undefined` for a text-layer read. Advisory only. */
  confidence?: number;
  elapsedMs: number;
  /** The attachment's hash when this was extracted — what makes the cache trustworthy. */
  contentHash: string;
  /**
   * Whether OCR has been run against these exact bytes, whatever it found
   * (migration 0166).
   *
   * What lets a scheduled job skip a scan it has already failed to read, instead of
   * re-recognising it on every pass forever. NOT derivable from `source`, which only
   * survives on a row where OCR *succeeded* — a failed attempt looks like a
   * text-layer row, and that is exactly the one the job must skip.
   */
  ocrAttempted: boolean;
  indexedAt: string;
  /** Empty unless `status` is `failed`. */
  error: string;
}

/** What a row needs to show its reading state, without the body. */
export interface AttachmentTextSummary {
  attachmentId: number;
  status: AttachmentTextStatus;
  source: AttachmentTextSource;
  charCount: number;
  confidence?: number;
  indexedAt: string;
}

/**
 * One full-text hit: which document, and the passage that matched.
 *
 * `snippet` arrives from FTS5 with the matched terms wrapped in `[` and `]` — the
 * view turns those into marks. Built in SQL rather than by slicing the body in JS
 * because FTS5 knows where the match actually was, and a JS `indexOf` would miss a
 * stemmed or diacritic-folded hit entirely.
 */
export interface AttachmentTextSearchHit {
  attachmentId: number;
  documentId: number;
  originalName: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Prefill templates (migration 0169)
// ---------------------------------------------------------------------------
//
// A named set of field values a new document can be filed from. Stored as JSON in
// doc_prefill_templates.fields_json; see migration 0169 for why that isn't a child
// table, and why `mode` is here when only one value is legal.

/**
 * The editor fields a template can prefill — which is every field the New Document
 * form has that isn't a file.
 *
 * Attachments are deliberately absent: a template fills *form fields*, and the
 * bytes of a document are the one part that is genuinely new each time. There is
 * nothing a stored template could say about them that the file picker doesn't.
 */
export type DocumentPrefillField = "title" | "description" | "categories" | "tags";

/**
 * How a field's value is produced when the template is applied.
 *
 * `literal` uses `value` as typed, and is currently the **only** legal mode — a
 * document has no date or time field, so there is nothing to resolve at apply-time.
 * The type is kept as a union of one so the stored shape matches the Journal's, and
 * so a future dated field costs a schema change rather than a data migration. See
 * migration 0169.
 */
export type DocumentPrefillMode = "literal";

/** One field of a template. */
export interface DocumentPrefillFieldValue {
  field: DocumentPrefillField;
  mode: DocumentPrefillMode;
  value: string;
}

/** A named template as stored. */
export interface DocumentPrefillTemplate {
  id: number;
  name: string;
  description: string;
  /** Disabled templates stay on the Prefill Templates screen but leave the editor
   *  form's picker. See 0169. */
  isEnabled: boolean;
  fields: DocumentPrefillFieldValue[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The subset of the New Document form a template can fill.
 *
 * Plain strings throughout, including `categories` and `tags` — which the form
 * holds as `string[]`. The template stores the delimited text and
 * `applyPrefillTemplate` returns it; splitting into the arrays the chip control
 * wants happens in `prefillValuesToFormState`, one function over, so the view never
 * parses anything. See migration 0169 on why `value` is one type for every field.
 */
export type DocumentPrefillFormValues = Record<DocumentPrefillField, string>;
