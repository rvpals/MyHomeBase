// Domain types for Clips: rich-text notes kept for their own sake, tagged and
// categorised, and optionally linked to a record in another module.
//
// No zod here and no SQL — `schema.ts` validates boundary input, `repository.ts`
// talks to the database, and these are the shapes everything else passes around.

import type { ClipCardColor } from "./schema";

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
  /**
   * Whether the clip sits in the board's pinned band, and first in the list.
   *
   * Shared, like the clip itself — there is no per-user pin, because there is no
   * per-user clip. Pinning is applied in the repository's ORDER BY, so the list
   * view and the board inherit the same order and cannot disagree about it.
   */
  isPinned: boolean;
  /**
   * Which card tint this clip wears, or `""` for the default surface.
   *
   * A **key** from `CLIP_CARD_COLORS`, never a hex — `design.md` forbids a literal
   * colour anywhere structural, and a stored hex would be the same pink card in all
   * eight themes including the two light ones. The key is resolved to a tint built
   * from the current theme's own tokens, so a coloured card recolours with the app.
   *
   * The keys are permanent, like an icon slot id: they are written into every
   * coloured clip's row, so renaming one blanks those cards back to the default.
   *
   * Typed as the union rather than `string` so a card, a picker or an action cannot
   * pass a colour the palette does not hold. The repository widens a stored value
   * back into this type on the way out — see `toClip`.
   */
  color: ClipCardColor | "";
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
  /** See `Clip.isPinned`. Carried on the summary because both views order by it. */
  isPinned: boolean;
  /** See `Clip.color`. A key from `CLIP_CARD_COLORS`, or `""`. */
  color: ClipCardColor | "";
  categories: string[];
  tags: string[];
  /**
   * The clip's checklist, in full.
   *
   * Carried on the **summary** — the one place this projection deliberately does not
   * trim — because a card draws its items and a board of 40 cards would otherwise
   * cost 40 extra round trips. They are safe to carry where the body is not: an item
   * is one short line by construction, where `content_html` can be a pasted email.
   * The repository fetches them for the whole page in one query.
   *
   * Empty for a clip with no checklist, which is most of them.
   */
  items: ClipItem[];
  /** How many images the clip holds, without fetching any of them. */
  imageCount: number;
  /** How many records elsewhere link to it. Drives the "linked" badge. */
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One tickable line on a clip.
 *
 * ## Why this is a row and not a checkbox in `contentHtml`
 *
 * `sanitizeClipHtml` removes `<input>` **with its contents** and refuses `style`
 * outright, both deliberately: a clip body is pasted email, and a working form inside
 * this app's own origin is worse than one in a mail client. Storing checklists as
 * markup would mean reopening that allowlist, and failing closed is the only thing
 * that makes it defensible.
 *
 * It is also wrong mechanically. Ticking a box would rewrite the entire
 * `content_html` column — potentially hundreds of kilobytes — on every click, and
 * re-run the sanitiser over it each time, with the tick surviving only if that round
 * trip happened to preserve it.
 *
 * So an item is a row and a tick is one UPDATE. A clip has both: the card draws the
 * body, then the items. Migration 0157 records the same reasoning.
 */
export interface ClipItem {
  id: number;
  clipId: number;
  /** What the line says. Never blank — an item with no text is not an item. */
  text: string;
  /** Ticking does not delete; the completed half stays, collapsed. */
  isDone: boolean;
  /**
   * ISO 8601 when it was ticked, or `undefined` while outstanding.
   *
   * Optional for the reason `TodoItem.doneAt` is: "not completed" genuinely has no
   * timestamp, where a sentinel date would read as a real completion.
   */
  doneAt?: string;
  /** Position among the outstanding items. Ignored once done — see `buildClipBoard`. */
  sortOrder: number;
  createdAt: string;
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
