// The My Journal module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages
// and the shell) read these values directly. Exporting them from the client nav
// module instead would hand the server client-reference proxies rather than the
// real objects, so a lookup like JOURNAL_SECTION_INFO[section] would come back
// undefined. Same reasoning as stock-sections.ts and expense-sections.ts.

export const JOURNAL_SECTIONS = [
  "main",
  "entries",
  "calendar",
  "views",
  "report",
  "log",
  "import",
  "calendar-import",
  "configuration",
  "templates",
  "metadata",
] as const;

export type JournalSection = (typeof JOURNAL_SECTIONS)[number];

export function isJournalSection(value: string): value is JournalSection {
  return (JOURNAL_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const JOURNAL_SECTION_INFO: Record<JournalSection, { label: string; description: string }> = {
  main: {
    label: "Home screen",
    description: "Today in history, recent entries, and quick actions.",
  },
  entries: {
    label: "Entries",
    description: "Browse and manage all journal entries.",
  },
  calendar: {
    label: "Calendar",
    description: "See your journal entries on a calendar.",
  },
  views: {
    label: "Views",
    description: "Custom views of your journal data.",
  },
  report: {
    label: "Report",
    description: "Summaries and reports from your journal.",
  },
  log: {
    label: "Log",
    description: "Logged activities — everything carrying the Log category.",
  },
  import: {
    // Slug stays "import" — it's the route and the icon-slot id, and renaming it
    // would orphan an uploaded icon override. The label narrows to "CSV Import"
    // now that it is one child of the Data Management group rather than the whole
    // of it; the group heading above it carries the wider name.
    label: "CSV Import",
    description: "Import a CSV file, reset the journal, and bulk-correct entries.",
  },
  "calendar-import": {
    label: "Calendar Import",
    description: "Import events from a Google Calendar .ics export.",
  },
  configuration: {
    label: "Preferences",
    description: "Preferences for how your journal works.",
  },
  templates: {
    label: "Templates",
    description: "Define different templates used in the journal module.",
  },
  metadata: {
    label: "Meta Data",
    description: "Categories and tags, and the icons that stand for them.",
  },
};

/**
 * The sections that hang under the "Configuration" group heading in the section
 * panel, in panel order.
 *
 * A group heading is not a destination — `SectionPanel` renders a node with
 * children as an accordion label, and drops it from the compact sheet's flat
 * list entirely ("Configuration isn't a place you can go"). So the existing
 * Configuration page keeps its route and becomes the group's first child,
 * relabelled "Preferences" to say what it actually holds; the heading itself is
 * synthesised in journal-shell.tsx and has no route of its own.
 */
export const JOURNAL_CONFIGURATION_SECTIONS: readonly JournalSection[] = [
  "configuration",
  "templates",
  "metadata",
];

/**
 * The sections under the "Data Management" group heading, in panel order.
 *
 * Same arrangement as the Configuration group above, and for the same reason:
 * the heading is synthesised in `journal-shell.tsx` with no route of its own,
 * so "Data Management" is a label rather than a destination.
 *
 * `import` stays first and keeps its slug — it is the existing route and the
 * existing icon-slot id, and renaming either would orphan an uploaded icon. Only
 * its label narrowed, to "CSV Import", now that it names one child instead of
 * the whole group.
 */
export const JOURNAL_DATA_MANAGEMENT_SECTIONS: readonly JournalSection[] = [
  "import",
  "calendar-import",
];

/** Section → nav icon key, resolved by TreeIcon. */
export const JOURNAL_SECTION_ICONS: Record<JournalSection, string> = {
  main: "grid",
  entries: "list",
  calendar: "history",
  views: "window",
  report: "chart",
  // `upload` — the same glyph Expense and Stock give their Import sections.
  import: "upload",
  // A wall calendar, for the section that reads one. Hand-drawn in
  // tree-icons.tsx: no Iconify set in TREE_ICON_GLYPHS covers this concept.
  "calendar-import": "calendar",
  // A clipboard — a running record of things that happened. Deliberately not
  // `list` (Entries') or `note` (Templates'), the two it sits nearest.
  log: "clipboard",
  configuration: "sliders",
  // `note`, not `list` — that one is Entries', and two sections wearing the same
  // glyph is the collision modules.md warns about. A template is a jotting you
  // start from, which is what the sticky-note mark reads as.
  templates: "note",
  // `shapes` is free as a section glyph — the Statistics card uses it inline for
  // categories, which is the same idea this section edits, not a collision with
  // another destination.
  metadata: "shapes",
};

const BASE_PATH = "/modules/journal";

/** The home screen is the module root; every other section is a child route. */
export function journalSectionHref(section: JournalSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}