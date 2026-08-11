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
  "configuration",
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
  configuration: {
    label: "Configuration",
    description: "Preferences for how your journal works.",
  },
};

/** Section → nav icon key, resolved by TreeIcon. */
export const JOURNAL_SECTION_ICONS: Record<JournalSection, string> = {
  main: "grid",
  entries: "list",
  calendar: "history",
  views: "window",
  report: "chart",
  configuration: "sliders",
};

const BASE_PATH = "/modules/journal";

/** The home screen is the module root; every other section is a child route. */
export function journalSectionHref(section: JournalSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}