import type {
  ColorSnippetInput,
  CreateSnippetData,
  PinSnippetInput,
  SnippetFilterInput,
  SnippetTaxonomyWriteInput,
  UpdateSnippetData,
} from "./schema";
import type {
  RecycledSnippet,
  Snippet,
  SnippetSummary,
  SnippetTaxonomyItem,
} from "./types";

/**
 * The repository the use-cases depend on — an interface, never a database.
 *
 * That is what lets the web app, the CLI and the tests each supply their own.
 */
export interface CodeLibraryRepository {
  // Snippets

  /**
   * Matching snippets as list rows, pinned first and then most recently updated.
   *
   * Returns the projection, not full bodies — except `code`, which the summary
   * carries for the Copy button. See `SnippetSummary`. An empty filter means
   * everything.
   */
  listSnippets(filter: SnippetFilterInput, previewLines: number): SnippetSummary[];

  /** One snippet in full, or `undefined` when the id does not exist. */
  getSnippetById(id: number): Snippet | undefined;

  /**
   * Writes a new snippet and returns it as stored.
   *
   * `createdBy` is attribution only and may be null — a snippet added from the CLI
   * has no session behind it. Writes the taxonomy pairings in the same
   * transaction, creating any category or tag that does not exist yet.
   */
  createSnippet(input: CreateSnippetData, createdBy: number | null): Snippet;

  /**
   * Replaces an existing snippet's fields, returning it as stored, or `undefined`
   * when the id does not exist.
   *
   * `undefined` rather than a throw so the use-case decides what a stale id means —
   * the same split `getSnippetById` makes.
   *
   * Does **not** touch `created_by`: editing someone else's snippet does not make
   * it yours. Does not touch `is_pinned` either — pinning is its own action, so a
   * save from the editor cannot silently unpin something. The `updated_at` trigger
   * handles the timestamp. Taxonomy pairings are replaced wholesale, in the same
   * transaction.
   */
  updateSnippet(input: UpdateSnippetData): Snippet | undefined;

  /** Sets or clears a snippet's pin. `false` when the id does not exist. */
  setSnippetPinned(input: PinSnippetInput): boolean;

  /** Sets or clears a snippet's card tint. `false` when the id does not exist. */
  setSnippetColor(input: ColorSnippetInput): boolean;

  /**
   * Writes a snippet's encrypted form, blanking the plaintext columns.
   *
   * Takes ciphertext, never a password — key derivation and encryption happen in
   * the use-case, so this file stays the one that only knows SQL. `false` when
   * the id does not exist.
   */
  sealSnippet(
    id: number,
    titleEncrypted: string,
    codeEncrypted: string,
    passwordHint: string,
  ): boolean;

  /**
   * Writes a snippet's plaintext back and clears the encrypted columns.
   *
   * Again plaintext in, never a password: the use-case has already decrypted.
   */
  unsealSnippet(id: number, title: string, code: string): boolean;

  // The recycle bin

  /**
   * Moves a snippet to the bin: copies the row and its pairings into the mirror
   * tables and deletes the originals, in one transaction.
   *
   * `false` when the id does not exist. Never destroys anything — only
   * `purgeRecycledSnippet` and `emptyRecycleBin` do.
   */
  recycleSnippet(id: number): boolean;

  /** The bin, most recently deleted first. */
  listRecycledSnippets(previewLines: number): RecycledSnippet[];

  /**
   * Restores one binned snippet, returning the id it came back as.
   *
   * Aims at the snippet's **original** id so an existing reference survives a
   * delete-and-restore, and falls back to a fresh one only when that id has been
   * taken. `undefined` when the bin row does not exist.
   */
  restoreRecycledSnippet(recycledId: number): number | undefined;

  /** Destroys one binned snippet for good. `false` when it does not exist. */
  purgeRecycledSnippet(recycledId: number): boolean;

  /** Destroys everything in the bin. Returns how many snippets went. */
  emptyRecycleBin(): number;

  // Taxonomy

  /** Every category, alphabetical, with how many snippets carry each. */
  listCategories(): SnippetTaxonomyItem[];

  /** Every tag, alphabetical, with how many snippets carry each. */
  listTags(): SnippetTaxonomyItem[];

  /**
   * Creates or updates a category.
   *
   * A rename (`previousName` set and different) rewrites every pairing row in the
   * same transaction — the name is the key, so anything less orphans the snippets
   * filed under the old word.
   */
  saveCategory(input: SnippetTaxonomyWriteInput): void;

  /** As `saveCategory`, for tags. */
  saveTag(input: SnippetTaxonomyWriteInput): void;

  /**
   * Removes a category and every pairing to it.
   *
   * The pairings go too, rather than the delete being refused while in use: the
   * category list is a vocabulary, and retiring a word should not require first
   * unfiling every snippet by hand. The snippets themselves are untouched.
   */
  deleteCategory(name: string): void;

  /** As `deleteCategory`, for tags. */
  deleteTag(name: string): void;
}
