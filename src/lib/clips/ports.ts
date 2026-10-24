import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ClipFilterInput } from "./schema";
import type { Clip, ClipImage, ClipLink, ClipLinkModule, ClipSummary, ClipTaxonomyItem } from "./types";

/** What the repository is handed to write a clip. Taxonomy arrives already trimmed. */
export interface ClipWriteData {
  title: string;
  contentHtml: string;
  categories: string[];
  tags: string[];
  createdBy: number | null;
}

/** The sealed form of a clip's text, written together so a clip is never half-sealed. */
export interface ClipEncryptionData {
  titleEncrypted: string;
  contentEncrypted: string;
  passwordHint: string;
}

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface ClipsRepository {
  // Clips
  /**
   * The list, newest first, as summaries — never full bodies, and never images.
   * An empty filter is the unfiltered list.
   */
  listClips(filter: ClipFilterInput): ClipSummary[];
  /** The full record, for an editor or a viewer. */
  getClipById(id: number): Clip | undefined;
  createClip(input: ClipWriteData): Clip;
  /** A full replace of the clip's own fields and its taxonomy, not a patch. */
  updateClip(id: number, input: ClipWriteData): Clip;
  /**
   * Deletes the clip, its taxonomy pairings, its images and its links, in one
   * transaction. This is the **only** way a clip is ever deleted: nothing in
   * another module can cause it, by design.
   */
  deleteClip(id: number): void;

  // Encryption
  /** Writes the sealed form and blanks the plaintext columns, in one transaction. */
  sealClip(id: number, data: ClipEncryptionData): Clip;
  /** Writes back the plaintext and clears the sealed columns and the hint. */
  unsealClip(id: number, title: string, contentHtml: string): Clip;

  // Taxonomy
  listCategories(): ClipTaxonomyItem[];
  listTags(): ClipTaxonomyItem[];
  /** Creates it, or returns the existing row — used by inline creation while writing. */
  upsertCategory(name: string, description: string): ClipTaxonomyItem;
  upsertTag(name: string, description: string): ClipTaxonomyItem;
  deleteCategory(name: string): void;
  deleteTag(name: string): void;
  /** The icon bytes, or undefined when none was uploaded. Served by a route. */
  getCategoryIcon(name: string): DecodedImage | undefined;
  getTagIcon(name: string): DecodedImage | undefined;
  setCategoryIcon(name: string, image: DecodedImage | null): void;
  setTagIcon(name: string, image: DecodedImage | null): void;

  // Images
  /** Metadata only — the list never pulls bytes. */
  listClipImages(clipId: number): ClipImage[];
  /** The bytes, for the serving route. */
  getClipImage(id: number): DecodedImage | undefined;
  /** Returns the stored row so the caller can rewrite the body to point at its id. */
  addClipImage(clipId: number, image: DecodedImage, width: number, height: number): ClipImage;
  deleteClipImage(id: number): void;

  // Links
  listLinksForClip(clipId: number): ClipLink[];
  /** Every clip attached to one record — what the journal's badge counts. */
  listLinksForTarget(targetModule: ClipLinkModule, targetId: number): ClipLink[];
  /**
   * Counts clips per target id in one query, so a list of 200 journal entries
   * costs one round trip rather than 200. Returns only ids that have at least one.
   */
  countLinksForTargets(targetModule: ClipLinkModule, targetIds: number[]): Map<number, number>;
  /** Idempotent: linking the same clip to the same record twice is not an error. */
  createLink(clipId: number, targetModule: ClipLinkModule, targetId: number): ClipLink;
  deleteLink(linkId: number): void;
}

/**
 * Decodes and resizes a pasted image.
 *
 * A port rather than a direct `sharp` call for the reason
 * `lib/modules/carousel-image-processor.ts` documents at length: `sharp` is a
 * native module reached through `wiring.ts`, which every page imports, so it is
 * loaded lazily behind this interface. A test supplies a fake and never touches
 * libvips.
 */
export interface ClipImageProcessor {
  /**
   * Resizes to fit within `maxEdge` and returns the bytes to store with their
   * final dimensions. An image already smaller is returned re-encoded but not
   * upscaled — enlarging a small screenshot only wastes bytes.
   */
  prepare(
    image: DecodedImage,
    maxEdge: number,
  ): Promise<{ image: DecodedImage; width: number; height: number }>;
}
