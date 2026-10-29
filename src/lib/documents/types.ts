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
