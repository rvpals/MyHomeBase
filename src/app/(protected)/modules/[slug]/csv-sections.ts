// The CSV Analysis module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from the client nav module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like CSV_SECTION_INFO[section] would come back undefined.
// Same reasoning as music-sections.ts and expense-sections.ts.

export const CSV_SECTIONS = ["main", "configuration"] as const;

export type CsvSection = (typeof CSV_SECTIONS)[number];

export function isCsvSection(value: string): value is CsvSection {
  return (CSV_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const CSV_SECTION_INFO: Record<CsvSection, { label: string; description: string }> = {
  main: {
    label: "Dashboard",
    description: "Import a CSV, then chart and browse what is in it.",
  },
  configuration: {
    label: "Configuration",
    description: "Defaults for importing and charting CSV files.",
  },
};

/** Section -> nav icon key, resolved by TreeIcon. */
export const CSV_SECTION_ICONS: Record<CsvSection, string> = {
  main: "grid",
  // `gear` rather than `sliders`: matches Music's Configuration, and both are
  // real TREE_ICONS concepts -- an invented key renders NOTHING rather than
  // falling back to a default.
  configuration: "gear",
};

const BASE_PATH = "/modules/csv-analysis";

/** The dashboard is the module root; every other section is a child route. */
export function csvSectionHref(section: CsvSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
