// The Clips module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from a client module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like CLIPS_SECTION_INFO[section] would come back undefined.
// Same reasoning as household-sections.ts, tools-sections.ts and journal-sections.ts.

import type { TreeIconConcept } from "@/lib/icons/tree-icon-names";

/**
 * `configuration` is last on purpose — the usual "settings at the bottom" place,
 * matching every other module's shell.
 *
 * Four sections, so no group headings: `modules.md` puts the nesting threshold at
 * about six. Adding a fifth screen is one string here plus a route branch.
 */
export const CLIPS_SECTIONS = ["main", "all", "metadata", "configuration"] as const;

export type ClipsSection = (typeof CLIPS_SECTIONS)[number];

export function isClipsSection(value: string): value is ClipsSection {
  return (CLIPS_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const CLIPS_SECTION_INFO: Record<ClipsSection, { label: string; description: string }> = {
  main: {
    label: "Home screen",
    description: "What is kept here, and what was written most recently.",
  },
  all: {
    label: "All Clips",
    description: "Every clip, filtered by category, tag or text.",
  },
  metadata: {
    label: "Categories & Tags",
    description: "The two lists a clip is filed under, and their icons.",
  },
  configuration: {
    label: "Configuration",
    description: "How Clips behaves.",
  },
};

/**
 * The glyph each section wears when no icon has been uploaded for its slot.
 *
 * These must match the `defaultConcept` of the matching `ICON_SLOTS` entry
 * (`clips_section_*` in src/lib/icons/slots.ts). A slot's default has to render what
 * the position rendered before it was slotted, or registering the slot is a visible
 * change rather than an invisible one — the lesson `household_section_recipes_import`
 * records.
 */
export const CLIPS_SECTION_ICONS: Record<ClipsSection, TreeIconConcept> = {
  main: "grid",
  all: "note",
  metadata: "list",
  configuration: "gear",
};

/**
 * The module's route prefix.
 *
 * A constant rather than a parameter, matching `household-sections.ts`: the slug is
 * fixed in `sys_modules` and `module-sections.ts` calls the href builder with the
 * section alone.
 */
const BASE_PATH = "/modules/clips";

/** The module root for `main`, a child route for everything else. */
export function clipsSectionHref(section: ClipsSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
