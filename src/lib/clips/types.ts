// Domain types for Clips: rich-text notes kept for their own sake, tagged and
// categorised, and optionally linked to a record in another module.
//
// No zod here and no SQL — `schema.ts` validates boundary input, `repository.ts`
// talks to the database, and these are the shapes everything else passes around.

/**
 * One clip, in full.
 *
 * `contentHtml` is sanitized markup (see `sanitize-html.ts`), never raw paste
 * input: the repository stores what the sanitizer returned and nothing else.
 *
 * ## Encrypted clips
 *
 * A sealed clip carries `isEncrypted: true`, blank `title`/`contentHtml`, and the
 * ciphertext in `titleEncrypted`/`contentEncrypted`. This mirrors a journal entry
 * exactly (migration 0131) — including that the taxonomy stays readable, so a
 * sealed clip still appears under its categories and tags.
 *
 * Unlike a journal entry, a clip is **shared**: anyone granted the module who has
 * the password can open it. The password is the only gate, which is also why
 * forgetting it loses the clip for everyone.
 */
export interface Clip {
  id: number;
  /** Blank while sealed — read `titleEncrypted` instead. */
  title: string;
  /** Sanitized HTML. Blank while sealed. */
  contentHtml: string;
  isEncrypted: boolean;
  /** `v1:salt:iv:tag:ciphertext`, or '' when not sealed. */
  titleEncrypted: string;
  /** `v1:salt:iv:tag:ciphertext`, or '' when not sealed. */
  contentEncrypted: string;
  /**
   * Stored in the clear, on purpose: it has to be readable *before* anyone can
   * decrypt. It must never contain the password — the UI says so.
   */
  passwordHint: string;
  categories: string[];
  tags: string[];
  /** Who wrote it. Attribution only — never a permission check. */
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A clip as a list row.
 *
 * A deliberate projection, not a trimmed `Clip`: the list never selects the
 * image blobs or the full body, so a screen showing 200 clips does not pull
 * every pasted email into memory. Anything editing a clip fetches the full
 * record instead.
 */
export interface ClipSummary {
  id: number;
  /** Already run through `displayTitle` — reads "(encrypted)" when sealed. */
  title: string;
  /**
   * First ~200 characters of the body with markup stripped, for the list's
   * second line. Blank when the clip is sealed: there is no plaintext to preview
   * and inventing one from the ciphertext would be noise.
   */
  excerpt: string;
  isEncrypted: boolean;
  categories: string[];
  tags: string[];
  /** How many images the clip holds, without fetching any of them. */
  imageCount: number;
  /** How many records elsewhere link to it. Drives the "linked" badge. */
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A managed category or tag, with its optional uploaded icon. */
export interface ClipTaxonomyItem {
  name: string;
  description: string;
  /**
   * The icon's mime type, or undefined when none was uploaded. The bytes
   * themselves are never carried on this type — they are served by
   * `/api/clips/{categories,tags}/[name]/icon`, the same split migration 0042
   * established for the journal's taxonomy.
   */
  iconMimeType?: string;
  /** How many clips carry it. */
  usageCount: number;
}

/**
 * One image pasted into a clip.
 *
 * The bytes live in a BLOB column and are served by `/api/clips/images/[id]`.
 * They are deliberately NOT inlined as base64 data URLs in `contentHtml`: that
 * is what `jrn_entry_images` did, and migration 0079 dropped it — base64 inflates
 * the stored bytes by a third and lands every image in every read of the row.
 */
export interface ClipImage {
  id: number;
  clipId: number;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sortOrder: number;
}

/**
 * Which module a clip link points into.
 *
 * A fixed set rather than a lookup against `sys_modules`, for the reason
 * migration 0142 records for `MESSAGE_MODULES`: the column is an enum the schema
 * validates at the boundary, so an unknown value fails loudly at the edge instead
 * of being stored and discovered later by a join that returns nothing.
 *
 * `journal` is the only member today. Adding another module means adding it here,
 * to the zod enum, and teaching the viewer how to resolve that module's title.
 */
export type ClipLinkModule = "journal";

/**
 * A clip attached to a record in another module.
 *
 * The link is one-directional by design: a clip knows what it is attached to, and
 * the other module does not know about clips. That keeps `src/lib/journal` free of
 * any dependency on `src/lib/clips`, which would otherwise be an import cycle.
 *
 * **Deleting the target never deletes the clip.** A clip exists independently and
 * is only *referenced* — so an entry that is deleted (or deleted and restored
 * under a fresh id) leaves a link pointing nowhere, which the viewer renders as
 * "the linked record is gone" rather than treating it as an error.
 */
export interface ClipLink {
  id: number;
  clipId: number;
  targetModule: ClipLinkModule;
  targetId: number;
  createdAt: string;
}

/** A link resolved against its target, for display. */
export interface ResolvedClipLink extends ClipLink {
  /**
   * The target's own title, or undefined when the target no longer exists.
   * Undefined is a normal state here, not a failure — see `ClipLink`.
   */
  targetTitle?: string;
  /** Where to send a reader who clicks it, or undefined when the target is gone. */
  targetHref?: string;
}
