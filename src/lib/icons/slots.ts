// THE registry of icon positions in this application.
//
// Until this file existed, the binding between "a place in the app" and "an icon" was a
// string literal at the call site — `<TreeIcon name="quote" />` in daily-quote-widget.tsx.
// That worked, but nothing could enumerate it, so no screen could offer a list of
// positions, and an override could only ever be per-*concept*. Concepts are shared: all
// five modules use `grid` for their dashboard and four use `chart` for their report, so
// "change the chart icon" would change four sections at once.
//
// Each entry names one position and declares the concept it falls back to.
//
// ## Adding a slot
//
// 1. Add an entry below with a `defaultConcept` that already renders correctly.
// 2. Swap that call site's `<TreeIcon name="x">` for `<SlotIcon slot={SLOT}>`.
//
// Step 1 alone changes nothing on screen — a slot nobody reads is inert — which is why
// slots can be adopted one call site at a time instead of in a single sweep. Entries here
// that are not yet wired up are listed as such in the table in modules.md.
//
// ## What does NOT belong here
//
// **State glyphs.** `star` vs `star-filled` encodes favourited-or-not, and play vs pause
// encodes transport state; letting someone override half a pair breaks the distinction the
// pair exists to carry. **Row actions.** pencil/trash/refresh/search are buttons, and
// `ALWAYS_CLASSIC` in tree-icons.tsx already keeps them hand-drawn so an inline delete
// control can't become full-colour artwork. **A module's own icon.** That is already
// user-configurable in Admin > Configuration > Module Configuration, backed by
// `sys_modules.icon`; a slot for it would be a second, competing way to set one value.
// That last rule is why the Today in History and Daily Glance cards are absent — both
// deliberately badge themselves with their module's icon.
//
// ## Naming
//
// `<area>_<kind>_<name>`, lower snake_case. The ids are persisted in
// `ico_slot_overrides.slot_id`, so renaming one orphans a user's upload — treat an id as
// permanent once shipped.

import type { IconSlot } from "./types";

export const ICON_SLOTS: IconSlot[] = [
  /* ---------------------------------------------------------------------------------
     Home screen. The three cards a reader sees before entering any module.
  --------------------------------------------------------------------------------- */
  {
    // The pilot slot, and the first one wired up. Chosen because the card is on the home
    // screen (so the effect of an override is impossible to miss) and its glyph is a grace
    // note — if an upload looks wrong here, nothing important is harder to use.
    id: "homescreen_card_daily_quote",
    label: "Daily Quote card",
    group: "Home screen",
    where: "Home screen → the Daily Quote card header, immediately left of the title.",
    wired: true,
    defaultConcept: "quote",
    namespace: "tree",
  },
  {
    id: "homescreen_card_photo_of_the_day",
    label: "Photo of the Day card",
    group: "Home screen",
    where:
      "Home screen → the Photo of the Day card, on the small caption button over the picture.",
    defaultConcept: "photo",
    wired: true,
    namespace: "tree",
  },
  {
    id: "homescreen_card_random_photo",
    label: "Random Photo card",
    group: "Home screen",
    where: "Home screen → the Random Photo card header, immediately left of the title.",
    defaultConcept: "photo",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Stocks & ETFs — nav sections. Section panel, left of each section name.
  --------------------------------------------------------------------------------- */
  {
    id: "stock_section_main",
    label: "Dashboard",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Dashboard.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_positions",
    label: "Positions",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Positions.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_transactions",
    label: "Transactions",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Transactions.",
    defaultConcept: "history",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_accounts",
    label: "Account Performance",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Account Performance.",
    defaultConcept: "database",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_actionables",
    label: "Actionables",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Actionables.",
    defaultConcept: "stock-quote",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_charts",
    label: "Chart & Analysis",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Chart & Analysis.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_simulation",
    label: "Simulation",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Simulation.",
    defaultConcept: "magic",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_import",
    label: "CSV Import",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → CSV Import.",
    defaultConcept: "upload",
    wired: true,
    namespace: "tree",
  },
  {
    id: "stock_section_settings",
    label: "Configuration",
    group: "Stocks & ETFs sections",
    where: "Stocks & ETFs → section panel → Configuration.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },

  {
    // Currently badged with the Stocks module's own icon. Registered so the card can be
    // given a mark of its own; until it is wired the module icon still wins.
    id: "stock_card_daily_glance",
    label: "Daily Glance card",
    group: "Stocks & ETFs cards",
    where: "Stocks & ETFs → Dashboard → the Daily Glance card header.",
    defaultConcept: "stock-quote",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Journal — nav sections and card headers.
  --------------------------------------------------------------------------------- */
  {
    id: "journal_section_main",
    label: "Home screen",
    group: "Journal sections",
    where: "Journal → section panel → Home screen.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_entries",
    label: "Entries",
    group: "Journal sections",
    where: "Journal → section panel → Entries.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_calendar",
    label: "Calendar",
    group: "Journal sections",
    where: "Journal → section panel → Calendar.",
    defaultConcept: "history",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_views",
    label: "Views",
    group: "Journal sections",
    where: "Journal → section panel → Views.",
    defaultConcept: "window",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_report",
    label: "Report",
    group: "Journal sections",
    where: "Journal → section panel → Report.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_configuration",
    label: "Preferences",
    group: "Journal sections",
    where: "Journal → section panel → Preferences.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_templates",
    label: "Templates",
    group: "Journal sections",
    where: "Journal → section panel → Templates.",
    defaultConcept: "note",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_section_metadata",
    label: "Meta Data",
    group: "Journal sections",
    where: "Journal → section panel → Meta Data.",
    defaultConcept: "shapes",
    wired: true,
    namespace: "tree",
  },
  {
    // Not in JOURNAL_SECTION_ICONS — the shell synthesises this accordion heading to wrap
    // Preferences and Templates, so it needs a slot of its own.
    id: "journal_section_configuration_group",
    label: "Configuration (group)",
    group: "Journal sections",
    where: "Journal → section panel → the Configuration group header (wraps Preferences and Templates).",
    defaultConcept: "gear",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_card_statistics",
    label: "Statistics card",
    group: "Journal cards",
    where: "Journal → Home screen → the Statistics card header.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_heading_top_tags",
    label: "Top Tags heading",
    group: "Journal cards",
    where: "Journal → Home screen → inside the Statistics card, the Top Tags sub-heading.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_heading_top_categories",
    label: "Top Categories heading",
    group: "Journal cards",
    where: "Journal → Home screen → inside the Statistics card, the Top Categories sub-heading.",
    defaultConcept: "shapes",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_card_recent_entries",
    label: "Recent Entries card",
    group: "Journal cards",
    where: "Journal → Home screen → the recent-entries card header.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_card_entry_filters",
    label: "Filters card",
    group: "Journal cards",
    where: "Journal → Entries → the filters card header, above the entry list.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },
  {
    id: "journal_card_entry_photos",
    label: "Photos card",
    group: "Journal cards",
    where: "Journal → open a single entry → the Photos card header.",
    defaultConcept: "photo",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     CSV Analysis — nav sections.
  --------------------------------------------------------------------------------- */
  {
    id: "csv_section_main",
    label: "Dashboard",
    group: "CSV Analysis sections",
    where: "CSV Data Analysis → section panel → Dashboard.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "csv_section_configuration",
    label: "Configuration",
    group: "CSV Analysis sections",
    where: "CSV Data Analysis → section panel → Configuration.",
    defaultConcept: "gear",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Expense — nav sections.
  --------------------------------------------------------------------------------- */
  {
    id: "expense_section_main",
    label: "Main (Dashboard)",
    group: "Expense sections",
    where: "Expense → section panel → Main (Dashboard).",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_transactions",
    label: "Transactions",
    group: "Expense sections",
    where: "Expense → section panel → Transactions.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_meta_data",
    label: "Meta Data",
    group: "Expense sections",
    where: "Expense → section panel → Meta Data.",
    defaultConcept: "database",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_charts",
    label: "Charts and Analysis",
    group: "Expense sections",
    where: "Expense → section panel → Charts and Analysis.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_import",
    label: "Import Transaction",
    group: "Expense sections",
    where: "Expense → section panel → Import Transaction.",
    defaultConcept: "upload",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_transaction_rules",
    label: "Transaction Rules",
    group: "Expense sections",
    where: "Expense → section panel → Transaction Rules.",
    defaultConcept: "clip",
    wired: true,
    namespace: "tree",
  },
  {
    id: "expense_section_settings",
    label: "Settings",
    group: "Expense sections",
    where: "Expense → section panel → Settings.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Attendance — nav sections.
  --------------------------------------------------------------------------------- */
  {
    id: "attendance_section_main",
    label: "Home screen",
    group: "Attendance sections",
    where: "Attendance → section panel → Home screen.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "attendance_section_rosters",
    label: "Rosters",
    group: "Attendance sections",
    where: "Attendance → section panel → Rosters.",
    defaultConcept: "users",
    wired: true,
    namespace: "tree",
  },
  {
    id: "attendance_section_classes",
    label: "Classes",
    group: "Attendance sections",
    where: "Attendance → section panel → Classes.",
    defaultConcept: "classroom",
    wired: true,
    namespace: "tree",
  },
  {
    id: "attendance_section_actions",
    label: "Student actions",
    group: "Attendance sections",
    where: "Attendance → section panel → Student actions.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },
  {
    id: "attendance_section_report",
    label: "Report",
    group: "Attendance sections",
    where: "Attendance → section panel → Report.",
    defaultConcept: "chart",
    wired: true,
    namespace: "tree",
  },
  {
    id: "attendance_section_configuration",
    label: "Configuration",
    group: "Attendance sections",
    where: "Attendance → section panel → Configuration.",
    defaultConcept: "gear",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Music Library — nav sections.
  --------------------------------------------------------------------------------- */
  {
    id: "music_section_main",
    label: "Library",
    group: "Music Library sections",
    where: "My Music Library → section panel → Library.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_section_magic",
    label: "Magic Playlist",
    group: "Music Library sections",
    where: "My Music Library → section panel → Magic Playlist.",
    defaultConcept: "magic",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_section_player",
    label: "Player",
    group: "Music Library sections",
    where: "My Music Library → section panel → Player.",
    defaultConcept: "player",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_section_queue",
    label: "Queue",
    group: "Music Library sections",
    where: "My Music Library → section panel → Queue.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_section_scan",
    label: "Scan Music",
    group: "Music Library sections",
    where: "My Music Library → section panel → Scan Music.",
    defaultConcept: "upload",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_section_configuration",
    label: "Configuration",
    group: "Music Library sections",
    where: "My Music Library → section panel → Configuration.",
    defaultConcept: "gear",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Music Library — the view tabs across the top of the Library section. A separate
     registry from the nav (`LIBRARY_VIEW_ICONS` in src/lib/music/browse.ts) and a
     separate place on screen, so the reuse between them is not a collision. `years`
     borrows `quote` for want of a better fit, which makes it a prime candidate for a
     replacement of its own.
  --------------------------------------------------------------------------------- */
  {
    id: "music_tab_all_songs",
    label: "All Songs tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the All Songs tab in the view strip.",
    defaultConcept: "list",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_artists",
    label: "Artists tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Artists tab in the view strip.",
    defaultConcept: "users",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_genres",
    label: "Genres tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Genres tab in the view strip.",
    defaultConcept: "shapes",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_playlists",
    label: "Playlists tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Playlists tab in the view strip.",
    defaultConcept: "note",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_most_played",
    label: "Most Played tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Most Played tab in the view strip.",
    defaultConcept: "history",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_years",
    label: "Years tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Years tab in the view strip.",
    defaultConcept: "quote",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_folders",
    label: "Folders tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Folders tab in the view strip.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "music_tab_folder_tree",
    label: "Folder Tree tab",
    group: "Music Library view tabs",
    where: "My Music Library → Library → the Folder Tree tab in the view strip.",
    defaultConcept: "database",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Admin. The nav entries down the left of every Admin screen. Ids follow the same
     `<namespace>_section_<slug>` rule the modules use, because `SectionPanel` derives them
     the same way — `adminNav`'s kebab ids become snake here. `palette` appears three times
     in the underlying nav (the Display Settings header, Color Themes and Dashboard
     Texture) — separating those is exactly what a per-position override buys over a
     per-concept one.
  --------------------------------------------------------------------------------- */
  {
    id: "admin_section_configuration",
    label: "Configuration (group)",
    group: "Admin navigation",
    where: "Admin → section panel → the Configuration group header.",
    defaultConcept: "sliders",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_configuration_modules",
    label: "Module Configuration",
    group: "Admin navigation",
    where: "Admin → Configuration → Module Configuration.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_configuration_application",
    label: "Application Configuration",
    group: "Admin navigation",
    where: "Admin → Configuration → Application Configuration.",
    defaultConcept: "window",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_display_settings",
    label: "Display Settings (group)",
    group: "Admin navigation",
    where: "Admin → section panel → the Display Settings group header.",
    defaultConcept: "palette",
    wired: true,
    namespace: "tree",
  },
  /* The three below sit under Display Settings, but their slot ids still read
     `configuration_*`: the nav ids they derive from were kept so that icons already
     uploaded for these positions survived the regrouping. Id, not label, is what a
     stored override matches on. */
  {
    id: "admin_section_configuration_themes",
    label: "Color Themes",
    group: "Admin navigation",
    where: "Admin → Display Settings → Color Themes.",
    defaultConcept: "palette",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_configuration_icons",
    label: "Icons",
    group: "Admin navigation",
    where: "Admin → Display Settings → Icons — this very screen's own nav entry.",
    defaultConcept: "shapes",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_configuration_texture",
    label: "Dashboard Texture",
    group: "Admin navigation",
    where: "Admin → Display Settings → Dashboard Texture.",
    defaultConcept: "palette",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_display_settings_widgets",
    label: "Dashboard Widgets",
    group: "Admin navigation",
    where: "Admin → Display Settings → Dashboard Widgets.",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_user_management",
    label: "User Management",
    group: "Admin navigation",
    where: "Admin → section panel → User Management.",
    defaultConcept: "users",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_daily_quote",
    label: "Daily Quote",
    group: "Admin navigation",
    where: "Admin → section panel → Daily Quote.",
    defaultConcept: "quote",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_daily_quote_add",
    label: "Add Quote",
    group: "Admin navigation",
    where: "Admin → Daily Quote → Add Quote.",
    defaultConcept: "plus",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_daily_quote_import",
    label: "Import from Newsletter",
    group: "Admin navigation",
    where: "Admin → Daily Quote → Import from Newsletter.",
    defaultConcept: "newspaper",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_security",
    label: "Security",
    group: "Admin navigation",
    where: "Admin → section panel → Security.",
    defaultConcept: "shield",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_background_tasks",
    label: "Background Tasks",
    group: "Admin navigation",
    where: "Admin → section panel → Background Tasks.",
    defaultConcept: "history",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_sql_explorer",
    label: "SQL Explorer",
    group: "Admin navigation",
    where: "Admin → section panel → SQL Explorer.",
    defaultConcept: "database",
    wired: true,
    namespace: "tree",
  },
  {
    id: "admin_section_about",
    label: "About",
    group: "Admin navigation",
    where: "Admin → section panel → About.",
    defaultConcept: "info",
    wired: true,
    namespace: "tree",
  },

  /* ---------------------------------------------------------------------------------
     Shared chrome. These appear on every screen, which cuts both ways: an override here
     is the most visible change available, and a poor one is the hardest to get away from.
     The module rail's per-module glyphs are deliberately absent — those are
     `sys_modules.icon`, already editable under Module Configuration.
  --------------------------------------------------------------------------------- */
  {
    // The app mark at the top of the module rail. Slotted even though it is the
    // application's own identity, because it is a *place* (the way home) and the
    // one icon present on every module screen.
    //
    // `defaultConcept` is a formality here: unlike every other slot, the call
    // site passes its own fallback (`AppIcon`, the brass coin-and-house mark),
    // because the real default is multi-colour artwork rather than a glyph from
    // either table. `home` is what a set-level replacement would land on.
    id: "chrome_rail_home",
    label: "Home / app mark",
    group: "Shared chrome",
    where: "Module rail → the app mark at the very top, above the divider.",
    defaultConcept: "home",
    wired: true,
    namespace: "module",
  },
  {
    id: "chrome_menu_modules_trigger",
    label: "Modules menu button",
    group: "Shared chrome",
    where: "Top header → the icon-only Modules dropdown button (a four-square grid).",
    defaultConcept: "grid",
    wired: true,
    namespace: "tree",
  },
  {
    id: "chrome_menu_account",
    label: "My Account row",
    group: "Shared chrome",
    where: "Top header → user menu → the My Account row.",
    defaultConcept: "users",
    wired: true,
    namespace: "tree",
  },
  {
    id: "chrome_menu_administration",
    label: "Administration row",
    group: "Shared chrome",
    where: "Top header → user menu → the Administration row.",
    defaultConcept: "shield",
    wired: true,
    namespace: "tree",
  },
  {
    id: "chrome_help_chip",
    label: "Help / About chip",
    group: "Shared chrome",
    where:
      "The small About chip on card headers across the app (Today In History, Daily Glance, Calendar and others).",
    defaultConcept: "info",
    wired: true,
    namespace: "tree",
  },
  {
    id: "chrome_admin_identity",
    label: "Administration section header",
    group: "Shared chrome",
    where: "Admin → the section panel header and breadcrumb badge for Administration itself.",
    defaultConcept: "shield",
    wired: true,
    namespace: "tree",
  },
];

/**
 * The slot id for one module section, derived rather than looked up.
 *
 * `SectionPanel` renders every module's nav from data, so it cannot name a slot per call
 * site the way a card header does. It calls this with its namespace and the node's id —
 * which is the section slug — and gets the id registered above.
 *
 * Hyphens become underscores: the section slugs are kebab (`meta-data`,
 * `transaction-rules`) while slot ids are snake throughout. A mismatch here does not
 * throw, it silently never matches an override, so `slots.test.ts` asserts every real
 * section resolves.
 */
export function sectionSlotId(namespace: string, sectionId: string): string {
  return `${namespace}_section_${sectionId.replace(/-/g, "_")}`;
}

/**
 * The slot id for one Music Library view tab, derived the same way sections are.
 *
 * The tab strip is data-driven too (`LIBRARY_VIEW_ICONS`), so it needs a derivation rather
 * than a slot named per call site. Kept as its own function rather than a `kind` parameter
 * on `sectionSlotId` because the two id shapes must stay independently greppable — the
 * registry is the map, and `_tab_` vs `_section_` is what says which strip a row belongs to.
 */
export function tabSlotId(namespace: string, tabId: string): string {
  return `${namespace}_tab_${tabId.replace(/-/g, "_")}`;
}

/** Slot ids are a closed set at runtime; an unknown one must never reach the database. */
export function getIconSlot(id: string): IconSlot | undefined {
  return ICON_SLOTS.find((slot) => slot.id === id);
}

export function isIconSlotId(id: string): boolean {
  return ICON_SLOTS.some((slot) => slot.id === id);
}

/**
 * Slots in display order, bucketed by `group`, for the admin list.
 *
 * Groups come out in the order they first appear in `ICON_SLOTS` rather than
 * alphabetically, so the registry's own ordering controls the screen.
 */
export function groupedIconSlots(): { group: string; slots: IconSlot[] }[] {
  const groups: { group: string; slots: IconSlot[] }[] = [];
  for (const slot of ICON_SLOTS) {
    const existing = groups.find((entry) => entry.group === slot.group);
    if (existing) existing.slots.push(slot);
    else groups.push({ group: slot.group, slots: [slot] });
  }
  return groups;
}
