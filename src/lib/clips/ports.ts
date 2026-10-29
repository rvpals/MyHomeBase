import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ClipCardColor, ClipFilterInput } from "./schema";
import type {
  Clip,
  ClipImage,
  ClipItem,
  ClipLink,
  ClipLinkModule,
  ClipSummary,
  ClipTaxonomyItem,
  RecycledClip,
} from "./types";

/** What the repository is handed to write a clip. Taxonomy arrives already trimmed. */
export interface ClipWriteData {
  title: string;
  contentHtml: string;
  categories: string[];
  tags: string[];
  /** A key from `CLIP_CARD_COLORS`, or `""` for the default surface. */
  color: ClipCardColor | "";
  createdBy: number | null;
}

/** One checklist line on its way in. No id for a line the reader just typed. */
export interface ClipItemWriteData {
  id?: number;
  text: string;
  isDone: boolean;
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
   * Deletes the clip, its taxonomy pairings, its images, its items and its
   * links, in one transaction — permanently, with no copy kept.
   *
   * Since migration 0161 this is **not** what the Delete button calls:
   * `recycleClips` is. This is the bin's own purge and the CLI's
   * `clips delete --forever`. Nothing in another module can cause it, by design.
   */
  deleteClip(id: number): void;

  // Recycle bin (migration 0161)

  /**
   * Moves clips into the bin, copying all six tables and then removing the
   * originals, in one transaction.
   *
   * Returns how many actually moved. An id that has already gone contributes
   * nothing and is skipped rather than throwing, so a double-submitted button
   * reports the truth instead of an error.
   */
  recycleClips(ids: number[]): number;
  /** Everything in the bin, newest deleted first. `excerptChars` bounds the preview. */
  listRecycledClips(excerptChars: number): RecycledClip[];
  /**
   * Puts binned clips back, keyed by `recycledId`.
   *
   * Restores at the clip's original id when that id is still free — which is what
   * keeps an existing `clp_clip_links` row, and the journal badge it draws,
   * working across a delete and a restore. Takes a fresh id when it isn't.
   */
  restoreRecycledClips(recycledIds: number[]): number;
  /** Removes rows from the bin for good. There is no undo past this point. */
  deleteRecycledClipsForever(recycledIds: number[]): number;
  /** Empties the bin. Returns how many went. */
  emptyClipsRecycleBin(): number;
  /** How many clips the bin holds — the number the confirmations quote. */
  countRecycledClips(): number;

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

  // Board
  /**
   * Pins or unpins a clip. Returns the updated record.
   *
   * Ordering is not this method's business: it writes the flag, and
   * `idx_clp_clips_pinned_updated` is what puts pinned clips first in every read.
   */
  setClipPinned(id: number, isPinned: boolean): Clip;
  /** Recolours a clip. `color` is a `CLIP_CARD_COLORS` key, or `""`. */
  setClipColor(id: number, color: ClipCardColor | ""): Clip;

  // Checklist items
  /** One clip's items, in `(sort_order, id)` order. */
  listClipItems(clipId: number): ClipItem[];
  /**
   * The items for many clips in **one** query, keyed by clip id.
   *
   * This is what lets `ClipSummary` carry its items: a board of 40 cards costs one
   * round trip rather than 40. The same shape, and the same reason, as
   * `countLinksForTargets` above. Clips with no items are absent from the map.
   */
  listClipItemsForClips(clipIds: number[]): Map<number, ClipItem[]>;
  /**
   * Replaces a clip's whole checklist in one transaction.
   *
   * A full replace rather than a patch, matching `updateClip`: the editor owns the
   * arrangement, and diffing item-by-item across a reorder would be a second way to
   * write the same rows. Items carrying an existing id keep it — and with it their
   * `done_at` — so a save that only reorders does not un-tick anything.
   */
  saveClipItems(clipId: number, items: ClipItemWriteData[]): ClipItem[];
  /** Ticks or un-ticks one item, stamping or clearing `done_at`. */
  toggleClipItem(itemId: number, isDone: boolean): ClipItem;

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
