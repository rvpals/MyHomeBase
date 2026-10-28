// Personal toolbars — a configurable bar of shortcuts docked to a screen edge.
//
// ## What this is NOT
//
// **A personal toolbar does not replace the main navigation.** `NavTree` (full
// layout) and `SectionPanel` (compact) stay exactly as they are; a toolbar is an
// *additional* surface alongside them, carrying the handful of destinations one
// household member uses constantly. Nothing about *where you are* lives here —
// that belongs to a navigation tier, per `design.md` → *Adding a UI element to the
// shell*. A toolbar is a set of shortcuts, and a reader who hides every toolbar
// loses no navigation at all.
//
// ## Ownership is split, like the floating layer's
//
// An **administrator** decides which toolbars exist and how each one looks (name,
// colors, edge, full-mode-only). Each **reader** decides whether a given toolbar is
// on their own screen. Same split `FLOATING_COMPONENTS` makes and for the same
// reason: "put that bar away" is a personal gesture, and an admin-only switch would
// leave a reader unable to undo their own screen.

/**
 * The five placements, in the order the admin form offers them.
 *
 * Four are screen edges. The fifth, `floating`, is a bar that sits **over** the
 * page at a position each reader drags for themselves — see `isFloatingEdge`.
 *
 * A `const` tuple rather than a `readonly ToolbarEdge[]`, and the type is derived
 * from it rather than declared alongside. That is what lets `z.enum(TOOLBAR_EDGES)`
 * infer the literal union instead of `string` — with a widened array zod infers
 * `string`, and every downstream consumer needs an unsound cast to get the union
 * back. One list, one source of truth, no casts.
 */
export const TOOLBAR_EDGES = ["top", "bottom", "left", "right", "floating"] as const;

/**
 * Where a toolbar lives: one of the four screen edges, or floating over the page.
 *
 * Still called an "edge" after migration 0153 added `floating`, which is a
 * deliberate choice not to rename. The column, the CHECK, the `data-edge`
 * attribute and every CSS rule keyed off it are all named this, and a rename
 * would touch all of them to improve one word. Read it as "placement".
 */
export type ToolbarEdge = (typeof TOOLBAR_EDGES)[number];

export function isToolbarEdge(value: string): value is ToolbarEdge {
  return (TOOLBAR_EDGES as readonly string[]).includes(value);
}

/**
 * Whether this placement floats over the page rather than docking to an edge.
 *
 * A named predicate rather than `edge === "floating"` at each call site, for the
 * same reason `isOrnamentalKind` exists: several places test for exactly this —
 * the renderer, `occupiedEdges`, the drag gate and the admin form — and a second
 * floating placement (were one ever added) would otherwise be silently treated as
 * docked by all of them.
 *
 * The load-bearing consequence is `occupiedEdges`: a floating bar reserves **no**
 * page space, because it is over the content by design rather than beside it.
 */
export function isFloatingEdge(edge: ToolbarEdge): boolean {
  return edge === "floating";
}

/**
 * What one row in a toolbar is.
 *
 * - `menu-item` — a shortcut to a destination, stored by its **menu item id**. The
 *   id is a plain string, not a foreign key: menu items are derived from code, not
 *   a table (see `src/lib/menu-items/types.ts`), so nothing at the database level
 *   can enforce that it still resolves. `resolveToolbar` handles that.
 * - `separator` — a **drawn dividing line** between two groups of items. Occupies a
 *   few pixels across the bar's thickness and nothing along it.
 * - `spacer` — **flexible empty space**. Takes all the room going, which is what
 *   pushes everything after it to the far end of the bar.
 *
 * The last two are deliberately different kinds rather than one with a flag. They
 * look nothing alike and do opposite things: a separator is a visible mark that
 * takes no room, a spacer is invisible and takes all of it. A reader wanting
 * "divide these two groups" and a reader wanting "push this to the end" are not
 * asking for the same control, and one kind serving both would be a checkbox
 * nobody could name.
 *
 * ## There was a `heading` kind, and it was removed
 *
 * It carried its own text ("My favourites") to label the items under it. It was
 * dropped in migration 0127 because **a text label does not fit a toolbar**: the bar
 * is 44px thick and its rows are single glyphs, so a heading either truncated to
 * nothing or forced the bar wider than the layout reserves for it. A separator does
 * the same grouping job with a mark instead of a word, which is why one replaced the
 * other rather than the idea being abandoned.
 *
 * Do not reintroduce it. If grouping ever needs to be *named* rather than marked,
 * that is a different surface — a bar of icons is not where a caption belongs.
 */
export const TOOLBAR_ITEM_KINDS = ["menu-item", "separator", "spacer"] as const;

export type ToolbarItemKind = (typeof TOOLBAR_ITEM_KINDS)[number];

export function isToolbarItemKind(value: string): value is ToolbarItemKind {
  return (TOOLBAR_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds that carry neither a label nor a destination — pure ornament.
 *
 * Since `heading` was removed this is "everything that is not a shortcut", and it is
 * kept as its own list rather than collapsed to `kind !== "menu-item"` for two
 * reasons: four call sites test for exactly this set (the schema's cross-field rule,
 * the resolver's passthrough, the trim logic, and the admin form), and a future kind
 * that *does* carry data would otherwise be silently treated as ornament by all four.
 */
export const ORNAMENTAL_TOOLBAR_KINDS = ["separator", "spacer"] as const;

export function isOrnamentalKind(kind: ToolbarItemKind): boolean {
  return (ORNAMENTAL_TOOLBAR_KINDS as readonly string[]).includes(kind);
}

/** One row of a toolbar, as stored. */
export interface ToolbarItem {
  id: number;
  toolbarId: number;
  kind: ToolbarItemKind;
  /**
   * The menu item this row points at, for `kind: "menu-item"`. Undefined for a
   * separator or a spacer.
   */
  menuItemId?: string;
  /**
   * An override for a menu item's own title — only meaningful on a `menu-item` row.
   *
   * Left unset, which is the common case, the row renders whatever the menu item
   * currently says, so an admin retitling a section on the Menu Items screen updates
   * every toolbar that points at it. Setting it here is a deliberate per-toolbar
   * nickname.
   *
   * It is **not drawn on the bar** — a toolbar row is its glyph alone. This is the
   * row's tooltip and its accessible name, which is the only thing naming a 44px
   * icon. (It used to double as a `heading` row's visible text; that kind is gone —
   * see `TOOLBAR_ITEM_KINDS`.)
   */
  label?: string;
  /**
   * Open this shortcut in a new tab instead of navigating the current one.
   *
   * Only meaningful on a `menu-item` row — the ornamental kinds are not clickable,
   * so they have nowhere to open. The schema rejects it on them outright, in the
   * same cross-field rule that already rejects a label there (migration 0158).
   *
   * Optional here and `NOT NULL DEFAULT 0` in the table, which is not a
   * contradiction: "not set" and "same tab" are the same thing, so an absent value
   * and `false` mean exactly one behaviour. There is no third state to carry.
   */
  opensNewTab?: boolean;
  sortOrder: number;
}

/** One toolbar, as stored. Items are fetched separately. */
export interface Toolbar {
  id: number;
  name: string;
  /**
   * The three colors, as CSS color strings.
   *
   * Stored verbatim rather than as theme token *names*, which is a deliberate
   * exception to `design.md`'s "colors are tokens, not literals" rule and is worth
   * being honest about: this is a user-authored surface, and the whole feature is
   * that an admin picks the colors. A token picker would be the stricter design and
   * would keep a toolbar in step with a theme change; it would also make "I want my
   * red bar" impossible. Undefined means "inherit the app's surface", which is the
   * default and keeps a toolbar themed until someone opts out.
   */
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  /**
   * The app texture library picture drawn behind this bar's glyphs, by id
   * (migration 0130). Undefined — the default and common case — is a flat bar.
   *
   * A plain id rather than a foreign key, so this can go **stale**: deleting a
   * library picture does not reach into the toolbars that pointed at it. A
   * pointer that no longer resolves renders as no texture, which `resolveToolbar`
   * handles — the same fall-through `resolveAppTexture` performs for a module's
   * stale pointer. See the migration for why that beats a cascade.
   */
  textureId?: number;
  /**
   * How strongly the texture shows, 0..1. Defaults to 0.15 in the table.
   *
   * Per-toolbar rather than taken from the library row, which is the one place a
   * toolbar's texture deliberately differs from a module's. A module fills a
   * viewport, so 0117 could reuse the picture's own tuning; a 44px strip shows a
   * few hundred square pixels, where a background tuned for a full page reads as
   * nothing at all. Always meaningful, even with no `textureId` — it is the value
   * the editor's slider starts from when a picture is first chosen.
   */
  textureOpacity: number;
  edge: ToolbarEdge;
  /**
   * Show this toolbar only on the full layout.
   *
   * The reason this flag exists: the bottom edge on compact is already claimed by
   * the section trigger and the music player, and the side edges are only ~390px
   * apart. A toolbar that is useful on a desktop is often simply in the way on a
   * phone, and this is the honest way to say so — rather than a `max-lg:` restyle
   * that pretends a 10-item bar fits.
   */
  fullModeOnly: boolean;
  /**
   * Whether the toolbar exists for the household at all — the admin's switch.
   *
   * Distinct from a reader's own visibility, which lives in their preferences. An
   * invisible toolbar is hidden from everyone regardless of their preference; a
   * visible one is still only on the screens of readers who have not hidden it.
   */
  isVisible: boolean;
  sortOrder: number;
}

/** A toolbar with its rows, which is how every consumer wants it. */
export interface ToolbarWithItems extends Toolbar {
  items: ToolbarItem[];
}

/**
 * One row, resolved for rendering: a menu item row has had its destination looked up.
 *
 * `href` and `title` are present only on a `menu-item` row whose id still resolves.
 * A row whose menu item has disappeared (a section deleted in a later release) is
 * **dropped** by `resolveToolbar` rather than rendered as a dead link — see there.
 */
export interface ResolvedToolbarItem {
  id: number;
  kind: ToolbarItemKind;
  /** The shortcut's name — its own nickname if set, else the menu item's title. */
  label?: string;
  /** Where a `menu-item` row goes. */
  href?: string;
  /** The glyph concept for a `menu-item` row. */
  icon?: string;
  /** The menu item id, so a caller can derive the icon slot. */
  menuItemId?: string;
  /**
   * Whether this shortcut opens in a new tab (migration 0158).
   *
   * Carried through to the renderer rather than recomputed there: the stored row is
   * the only thing that knows, and a component reaching back for it would be the
   * second place deciding what a row does on click.
   */
  opensNewTab?: boolean;
}

/**
 * A texture resolved for rendering: the picture's URL and how strongly to draw it.
 *
 * The URL is built in `lib`, not at the call site, for the same reason
 * `resolveAppTexture` builds its own: it carries a `?v=` cache-buster taken from
 * the library row's `updatedAt`, because the serving route sends a 5-minute
 * max-age and a replaced picture would otherwise appear not to change. A
 * component handed a bare id would have to know that, and would be the third
 * place to get it subtly wrong.
 *
 * No `mode` and no `blur`: a toolbar always tiles, since `cover` on a 44px bar
 * shows one sliver of a picture. See migration 0130.
 */
export interface ResolvedToolbarTexture {
  /** A ready-to-use CSS `url(...)` value, cache-buster included. */
  image: string;
  /** 0..1, from the toolbar's own column rather than the library row's. */
  opacity: number;
}

/** A toolbar ready to render: colors, edge, and rows that all resolve. */
export interface ResolvedToolbar {
  id: number;
  name: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  /**
   * The background picture, or `undefined` when this bar has none — which covers
   * both "no picture chosen" and "chosen picture has since been deleted".
   *
   * Undefined rather than a zero-opacity texture, so the renderer can leave the
   * custom properties off entirely: an unset `background-image` makes the
   * pseudo-element free, where one at opacity 0 still costs a paint. Same
   * reasoning `ResolvedAppTexture` records for its optional `vars`.
   */
  texture?: ResolvedToolbarTexture;
  edge: ToolbarEdge;
  fullModeOnly: boolean;
  items: ResolvedToolbarItem[];
}
