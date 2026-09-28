// My Shortcuts — a person's own jump-off points on the home screen.
//
// A shortcut is three things the reader supplies: an icon, a name and a
// destination. The destination comes in two flavours, and that is the only real
// structure in this module.

/**
 * Where a shortcut points.
 *
 * - `url` — anywhere on the web, stored verbatim.
 * - `section` — a place inside this app, stored as coordinates into the
 *   navigation tree rather than as a path. See `ShortcutTarget`.
 *
 * A union of two rather than a boolean `isExternal`, because the two carry
 * *different fields*, not the same field with a flag beside it.
 */
export type ShortcutKind = "url" | "section";

/** The glyph a shortcut falls back to when none was chosen, or when the stored one is gone. */
export const DEFAULT_SHORTCUT_ICON = "rocket";

/**
 * The most an uploaded shortcut icon may weigh, before downscaling.
 *
 * Generous for what this is — the picture is re-encoded to a small WebP on the
 * way in, so the stored column holds far less. The cap exists to reject a
 * multi-megabyte photograph at the door rather than to size the column, and is
 * checked in the browser too so an oversized file fails instantly with our own
 * wording instead of a 500.
 */
export const MAX_SHORTCUT_ICON_BYTES = 256 * 1024;

/**
 * The longest edge an uploaded icon is stored at.
 *
 * A tile draws it at roughly 28px, so 128 keeps it crisp on a high-DPI screen
 * with room to spare. Storing the original instead is the mistake the module
 * carousel made and migration 0040 recorded: a 2 MB picture downloaded whole to
 * fill a small tile is what made that strip paint in slowly.
 */
export const SHORTCUT_ICON_MAX_EDGE = 128;

/**
 * How many shortcuts one person may keep.
 *
 * A soft cap on a home-screen card, not a storage limit: the card is a grid the
 * reader is meant to scan at a glance, and an unbounded list would push every
 * other widget off the screen. Twelve fills three rows of four on a desktop and
 * six rows of two on a phone.
 */
export const MAX_SHORTCUTS_PER_USER = 12;

/** One shortcut, as stored. */
export interface Shortcut {
  id: number;
  userId: number;
  kind: ShortcutKind;
  /** The reader's own wording — never derived from the target. */
  name: string;
  /**
   * A `TREE_ICONS` concept name. Not an icon slot id — see the migration log.
   *
   * Always set, even when `hasIconImage` is true: it is what the tile falls back
   * to if the upload is removed, so a shortcut is never left with no icon.
   */
  icon: string;
  /**
   * Whether this shortcut has an uploaded picture, which **wins over `icon`**.
   *
   * Presence, not bytes — the rule `coding-guide.md` states for every per-row
   * image. A caller only needs to know which of the two to draw; the bytes have
   * exactly one reader, the serving route.
   */
  hasIconImage: boolean;
  /** `kind === "url"` only; `""` otherwise. */
  url: string;
  /** `kind === "section"` only; `""` otherwise. */
  moduleSlug: string;
  /**
   * The section within `moduleSlug`, or `""` for the module root itself.
   *
   * Empty-with-a-slug is what a "shortcut to Journal" looks like, which is why
   * there is no separate `module` kind.
   */
  sectionId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A shortcut as it arrives from a form, before it has an id or an owner.
 *
 * `sortOrder` is absent deliberately: position is decided by the store (append
 * at the end) or by an explicit reorder, never by whoever is filling in the
 * dialog.
 */
export interface ShortcutDraft {
  kind: ShortcutKind;
  name: string;
  icon: string;
  url: string;
  moduleSlug: string;
  sectionId: string;
}

/**
 * A shortcut resolved against the live navigation tree, ready to draw.
 *
 * This is what the card renders, and it is deliberately a *different type* from
 * `Shortcut`: a stored row does not know whether its target still exists or
 * whether this reader may reach it, and both questions have to be answered
 * before a tile can be drawn. Keeping the answers in the type means the view
 * cannot forget to ask.
 */
export interface ResolvedShortcut {
  id: number;
  name: string;
  /** The glyph to draw — only when `iconImageUrl` is absent. */
  icon: string;
  /**
   * Where to fetch this shortcut's uploaded picture, or `undefined` when it has
   * none and the glyph should be drawn instead.
   *
   * A URL rather than a boolean because the view needs the cache-buster too, and
   * building it here keeps the `?v=` rule in one place rather than in every
   * caller. Still never the bytes.
   */
  iconImageUrl?: string;
  kind: ShortcutKind;
  /** Where the tile links. Empty when `reachable` is false — there is nowhere to go. */
  href: string;
  /**
   * Whether this reader can actually follow it right now.
   *
   * False for a section shortcut into a module the reader has lost access to, or
   * one whose section no longer exists. The card shows these as disabled with a
   * reason rather than hiding them: a tile that vanishes silently looks like data
   * loss, and the reader is the only one who can decide whether to fix or remove it.
   */
  reachable: boolean;
  /** Why it can't be followed, for the tile's tooltip. `undefined` when reachable. */
  unreachableReason?: string;
  /**
   * The stored target, carried through unresolved so the edit dialog can reopen
   * on the values that were saved.
   *
   * Deriving these back out of `href` was the obvious alternative and is wrong:
   * a section's href is whatever its module's `*SectionHref` builder returns,
   * which is not required to be `/modules/<slug>/<section>` and is deeper than
   * that in places. Parsing it would work until the first module that didn't
   * follow the pattern. Carrying the coordinates costs two strings.
   *
   * Also the only way to edit an **unreachable** shortcut: that one has no href
   * at all, so there would be nothing to parse.
   */
  target: {
    kind: ShortcutKind;
    url: string;
    moduleSlug: string;
    sectionId: string;
  };
}
