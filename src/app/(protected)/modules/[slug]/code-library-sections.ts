// The Code Library module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section page and
// the shell) read these values directly. Exporting them from a client module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like CODE_LIBRARY_SECTION_INFO[section] would come back
// undefined. Same reasoning as clips-sections.ts and journal-sections.ts.

import { slotNamespaceFor } from "@/components/nav-slot-namespaces";
import type { TreeIconConcept } from "@/lib/icons/tree-icon-names";

/**
 * Three sections: the home screen (which *is* the module), the vocabulary behind
 * its chips, and the bin.
 *
 * Nesting starts at about six sections, so this stays flat.
 */
export const CODE_LIBRARY_SECTIONS = ["main", "metadata", "recycled"] as const;

export type CodeLibrarySection = (typeof CODE_LIBRARY_SECTIONS)[number];

export function isCodeLibrarySection(value: string): value is CodeLibrarySection {
  return (CODE_LIBRARY_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const CODE_LIBRARY_SECTION_INFO: Record<
  CodeLibrarySection,
  { label: string; description: string }
> = {
  main: {
    label: "Code Library home",
    description: "Every snippet — find one, copy it, keep it filed by language.",
  },
  metadata: {
    label: "Categories & Tags",
    description: "The two lists a snippet is filed under, and how often each is used.",
  },
  recycled: {
    label: "Recycled Snippets",
    description:
      "Deleted snippets, kept until you empty the bin. Restore one, or remove it for good.",
  },
};

/**
 * The glyph each section wears when no icon has been uploaded for its slot.
 *
 * These must match the `defaultConcept` of the matching `ICON_SLOTS` entry
 * (`code_library_section_*` in src/lib/icons/slots.ts). A slot's default has to
 * render what the position rendered before it was slotted, or registering the slot
 * is a visible change rather than an invisible one — the lesson
 * `household_section_recipes_import` records.
 *
 * `grid` rather than something code-shaped: there is no `code` concept in
 * `TREE_ICON_NAMES`, and adding one means drawing it for the classic set and naming
 * it in all twelve candidate maps in `scripts/gen-icon-glyphs.mjs`.
 */
export const CODE_LIBRARY_SECTION_ICONS: Record<CodeLibrarySection, TreeIconConcept> = {
  main: "grid",
  metadata: "list",
  recycled: "trash",
};

/**
 * The module's route prefix.
 *
 * A constant rather than a parameter, matching `clips-sections.ts`: the slug is
 * fixed in `sys_modules` and `module-sections.ts` calls the href builder with the
 * section alone.
 */
const BASE_PATH = "/modules/code-library";

/** The module root for `main`, a child route for everything else. */
export function codeLibrarySectionHref(section: CodeLibrarySection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}

/**
 * The namespace every one of this module's icon slots is derived from.
 *
 * `sectionSlotId` replaces hyphens in the *section* id but not in the namespace,
 * so passing the `code-library` slug here would produce `code-library_section_main`
 * — a hyphen in an id that every other module spells with underscores. Declared
 * once, here, and passed to `TwoTierShell` as `iconNamespace`, so the ids in
 * `src/lib/icons/slots.ts` and the ones the panel derives can never drift apart.
 */
export const CODE_LIBRARY_ICON_NAMESPACE = slotNamespaceFor("code-library");
