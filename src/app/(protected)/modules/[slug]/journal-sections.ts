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
  "import",
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
  import: {
    label: "Import",
    description: "Bring journal entries in from a CSV file.",
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

/** Section → nav icon key, resolved by TreeIcon. */
export const JOURNAL_SECTION_ICONS: Record<JournalSection, string> = {
  main: "grid",
  entries: "list",
  calendar: "history",
  views: "window",
  report: "chart",
  // `upload` — the same glyph Expense and Stock give their Import sections.
  import: "upload",
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