// The Tools module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from a client module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like TOOLS_SECTION_INFO[section] would come back undefined.
// Same reasoning as csv-sections.ts and music-sections.ts.

export const TOOLS_SECTIONS = ["main", "todo", "sqlite-browser", "csv-browser"] as const;

export type ToolsSection = (typeof TOOLS_SECTIONS)[number];

export function isToolsSection(value: string): value is ToolsSection {
  return (TOOLS_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const TOOLS_SECTION_INFO: Record<ToolsSection, { label: string; description: string }> = {
  main: {
    label: "Dashboard",
    description: "The utilities and tools available here.",
  },
  todo: {
    label: "TODO Lists",
    description: "The household's shared lists of things to do.",
  },
  "sqlite-browser": {
    label: "SQLite File Browser",
    description: "Upload a SQLite file and browse, filter and delete the rows inside it.",
  },
  "csv-browser": {
    label: "CSV File Browser",
    description: "Upload a CSV or text file and browse, filter, edit and delete the rows in it.",
  },
};

/**
 * Section -> nav icon key, resolved by TreeIcon.
 *
 * All four are real TREE_ICONS concepts — an invented key renders NOTHING rather
 * than falling back to a default.
 */
export const TOOLS_SECTION_ICONS: Record<ToolsSection, string> = {
  main: "grid",
  // `clipboard`, not `list`: `list` is the home screen's one-column layout button and
  // several "rows of something" navs, where this means a checklist specifically. The
  // two sit in the same panel as `database` and `csv-file`, so a shared glyph would
  // make them harder to tell apart, not easier.
  todo: "clipboard",
  "sqlite-browser": "database",
  "csv-browser": "csv-file",
};

const BASE_PATH = "/modules/tools";

/** The dashboard is the module root; every other section is a child route. */
export function toolsSectionHref(section: ToolsSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
