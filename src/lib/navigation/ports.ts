// The seam that lets `src/lib/navigation` build a tree over sections it cannot import.
//
// The nine `*-sections.ts` files live in `src/app/(protected)/modules/[slug]/`,
// next to the routes whose hrefs they generate. `src/lib/` may not import from
// `src/app/` — so the tree asks for sections through this interface and the
// composition root supplies them, exactly as `deps` already supplies repositories.
//
// The alternative was moving all nine section lists down into `src/lib/`. Rejected
// because a section list is route knowledge: `journalSectionHref` builds a URL that
// only means anything next to the route that serves it, and splitting the slug list
// from the route would put the two halves of one fact in two layers.

import type { TreeSection } from "./types";

/**
 * Supplies one module's sections, flattened to leaves with their group heading
 * carried as a label.
 *
 * Returns `[]` — never throws — for a slug it doesn't know. A module row can exist
 * in `sys_modules` with no section file yet (that is the state every new module is
 * in between its migration and its shell), and navigation that throws on a
 * half-built module would take the whole app down rather than the one heading.
 */
export interface SectionSource {
  sectionsFor(moduleSlug: string): TreeSection[];
}
