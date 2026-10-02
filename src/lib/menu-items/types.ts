// The menu item model — every reachable destination in the app, as addressable data.
//
// A **menu item** is one navigable subnode: a module section, an Administration
// screen, or Home. It is the unit a personal toolbar points at, and the unit an
// administrator can retitle.
//
// ## The id is the icon slot id — there is no second id space
//
// Every section already has a permanent, derived, persisted identity:
// `sectionSlotId(namespace, slug)` produces `journal_section_locations`, which is
// registered in `ICON_SLOTS` and is what `ico_slot_overrides.slot_id` stores. A
// menu item reuses exactly that string.
//
// Minting a parallel numeric id was considered and rejected. It would have given
// every subnode two identities and two places to set an icon, which is the trap
// `coding-guide.md` names under *What must NOT become a slot* ("a second, competing
// way to set one value"). Reuse also means the id allocates itself from the slug —
// there is no counter to increment and nothing to forget when adding a section.
//
// The consequence, and it is the same rule the slot registry already carries:
// **a menu item id is permanent once shipped.** It is written into
// `sys_menu_item_overrides.menu_item_id` and (as a slot id) into
// `ico_slot_overrides.slot_id`, and later into each toolbar's rows. Renaming a
// section slug silently orphans both.

/** Where a menu item came from — what kind of place it is, not what it looks like. */
export type MenuItemKind =
  /** The dashboard. Belongs to no module; exactly one of these exists. */
  | "home"
  /** A section of a registered feature module. The overwhelming majority. */
  | "module-section"
  /** An Administration screen. Administration has no `sys_modules` row. */
  | "admin";

/**
 * One reachable destination, after any administrator override has been applied.
 *
 * This is the resolved shape — `title` and `hint` are what should be rendered, not
 * what the section file declared. `defaultTitle` is kept alongside so the admin
 * screen can show what it would revert to, and so the "is this overridden?" badge
 * needs no second lookup.
 */
export interface MenuItem {
  /**
   * The icon slot id, e.g. `journal_section_locations`. Permanent — see the header.
   *
   * Unique across the whole app, unlike a section slug, which is unique only within
   * its module (`configuration` names six different screens).
   */
  id: string;
  kind: MenuItemKind;
  /** The title to render — the override if one exists, else `defaultTitle`. */
  title: string;
  /** The one-line description to render. Same override rule as `title`. */
  hint?: string;
  /** What the registry declares, before overrides. What "Reset" restores. */
  defaultTitle: string;
  /** The registry's description, before overrides. */
  defaultHint?: string;
  /** Whether an administrator has retitled or re-described this item. */
  isOverridden: boolean;
  /**
   * The owning module's slug (`journal`), `"admin"` for an Administration screen, or
   * `undefined` for Home — which deliberately belongs to no module.
   */
  moduleSlug?: string;
  /** The owning module's display name, for grouping the picker and the admin list. */
  moduleName: string;
  /** Where it goes. Carries Home's `?home=1` verbatim — see `HOME_SECTION`. */
  href: string;
  /**
   * The heading this item sits under inside its module ("Configuration",
   * "Data Management"), or `undefined`. Journal and Household are the only grouped
   * modules; Administration groups most of its screens.
   */
  group?: string;
  /** The glyph concept this item's icon slot falls back to when nothing is uploaded. */
  icon?: string;
}

/**
 * One administrator override, as stored.
 *
 * Sparse: a row exists only where something was actually changed, so the registry is
 * the default and the table is the exception. A field left `undefined` means "use the
 * registry's value", which is why both are optional rather than defaulting to "".
 */
export interface MenuItemOverride {
  menuItemId: string;
  title?: string;
  hint?: string;
  updatedAt: string;
}
