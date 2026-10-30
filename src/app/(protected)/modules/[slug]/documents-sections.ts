// The Document Library's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and the
// shell) read these values directly. Exporting them from a client module instead would
// hand the server client-reference proxies rather than the real objects, so a lookup
// like DOCUMENTS_SECTION_INFO[section] would come back undefined. Same reasoning as
// clips-sections.ts, household-sections.ts and journal-sections.ts.

import type { TreeIconConcept } from "@/lib/icons/tree-icon-names";

/**
 * `configuration` is last on purpose — the usual "settings at the bottom" place,
 * matching every other module's shell.
 *
 * Five sections, so still no group headings: `modules.md` puts the nesting threshold
 * at about six.
 *
 * `tree` sits next to `main` because they are the same documents seen two ways — the
 * flat grid with its bulk edits, and the category/tag tree with a reading pane. Not a
 * replacement for either: a reader who knows the title searches the grid, a reader
 * who is browsing opens the tree.
 *
 * There is no separate "All Documents" row. The home screen *is* the list, filter box
 * and all — the shape Clips settled on when it absorbed its own `all` section. A second
 * route showing the same documents would have been the same screen twice.
 *
 * `recycled` sits immediately before `configuration` (migration 0163), the same place
 * Clips puts its bin: it is a destination you visit to undo something, not a setting.
 */
export const DOCUMENTS_SECTIONS = [
  "main",
  "tree",
  "metadata",
  "recycled",
  "configuration",
] as const;

export type DocumentsSection = (typeof DOCUMENTS_SECTIONS)[number];

export function isDocumentsSection(value: string): value is DocumentsSection {
  return (DOCUMENTS_SECTIONS as readonly string[]).includes(value);
}

/**
 * The editor's routes, which are **not** sections.
 *
 * They are reachable at `/modules/documents/new` and `/modules/documents/edit`, so the
 * `[section]` route has to recognise them — but they are not nav destinations and
 * carry no icon slot, because a slot marks a place and "the form I am filling in" is
 * not one. Kept beside the section list so the route guard and the nav can't drift.
 */
export const DOCUMENTS_EDITOR_ROUTES = ["new", "edit"] as const;

export type DocumentsEditorRoute = (typeof DOCUMENTS_EDITOR_ROUTES)[number];

export function isDocumentsEditorRoute(value: string): value is DocumentsEditorRoute {
  return (DOCUMENTS_EDITOR_ROUTES as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const DOCUMENTS_SECTION_INFO: Record<
  DocumentsSection,
  { label: string; description: string }
> = {
  main: {
    label: "Home screen",
    description: "Every document — file one, filter them, open what you need.",
  },
  tree: {
    label: "Document Tree",
    description: "Browse by category, narrow by tag, and read a document beside the list.",
  },
  metadata: {
    label: "Categories & Tags",
    description: "The two lists a document is filed under, and their icons.",
  },
  recycled: {
    label: "Recycled Documents",
    description: "Deleted documents — restore one, or remove it for good.",
  },
  configuration: {
    label: "Configuration",
    description: "Where the files are kept, and what the Document Library allows.",
  },
};

/**
 * The glyph each section wears when no icon has been uploaded for its slot.
 *
 * These must match the `defaultConcept` of the matching `ICON_SLOTS` entry
 * (`documents_section_*` in src/lib/icons/slots.ts). A slot's default has to render
 * what the position rendered before it was slotted, or registering the slot is a
 * visible change rather than an invisible one — the lesson
 * `household_section_recipes_import` records.
 */
export const DOCUMENTS_SECTION_ICONS: Record<DocumentsSection, TreeIconConcept> = {
  main: "grid",
  // `network` rather than a new glyph: it is the registry's branching-structure mark,
  // so registering the slot draws what the position would have drawn anyway. There is
  // no "tree" concept in TREE_ICON_NAMES, and adding one for a single section would
  // mean a glyph nothing else asks for.
  tree: "network",
  metadata: "list",
  recycled: "trash",
  configuration: "gear",
};

/**
 * The module's route prefix.
 *
 * A constant rather than a parameter, matching `clips-sections.ts` and
 * `household-sections.ts`: the slug is fixed in `sys_modules` and `module-sections.ts`
 * calls the href builder with the section alone.
 */
const BASE_PATH = "/modules/documents";

/** The module root for `main`, a child route for everything else. */
export function documentsSectionHref(section: DocumentsSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}

/**
 * Where the editor opens: `new`, or `edit?edit=<id>` for an existing document.
 *
 * `?edit=` rather than a fresh `?id=`: the Journal's report editor and the Classroom's
 * exam editor both already use that param to mean "open this record for editing", and
 * the `[section]` route parses it once for all of them. A second name for the same idea
 * would only make the URL harder to read.
 */
export function documentsEditorHref(documentId?: number): string {
  return documentId === undefined ? `${BASE_PATH}/new` : `${BASE_PATH}/edit?edit=${documentId}`;
}
