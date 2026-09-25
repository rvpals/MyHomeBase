// Filtering the navigation tree — the control that makes ~70 sections navigable.
//
// In the old section panel a filter would have searched one module's 7-14 sections,
// which is barely worth an input. Over the whole tree it is the primary way to reach
// a section you don't visit often, which is why it earns a place above the tree and
// why the matching lives here rather than inline in the component.
//
// **Labels only, across every module.** Not the `hint` descriptions: searching those
// finds sections by what they do rather than what they are called, which sounds
// better than it reads — "import" appears in half the descriptions in the app and
// the result is a list that looks unfiltered. The module name is shown *beside* each
// hit instead, so a reader can tell three "CSV Import" rows apart without the query
// having to match the module too.

import { flattenTree } from "./tree";
import type { NavigationTree, TreeModule, TreeSection } from "./types";

/** One hit: the section, and the module it belongs to so the row can name it. */
export interface FilterHit {
  module: TreeModule;
  section: TreeSection;
  /**
   * Where the query matched in the label, for the component to mark. `-1` when the
   * hit came from a module-name match rather than the label.
   */
  matchIndex: number;
}

/** A module-name match: the heading matched, so all its sections are hits. */
function matchesModule(module: TreeModule, needle: string): boolean {
  return module.name.toLowerCase().includes(needle);
}

/**
 * Every section matching `query`, best first.
 *
 * Ranking, in order:
 *   1. a label that *starts* with the query, over one that merely contains it
 *   2. within that, the earlier match position
 *   3. within that, the module's own order, then the section's
 *
 * Prefix-first because typing is prefix-shaped: someone typing "cal" means Calendar
 * far more often than they mean "Technical Analysis". Without it, alphabetical
 * accidents decide, and the section you wanted is fourth.
 *
 * An empty or whitespace query returns `[]` rather than everything — "no filter" is
 * the caller's state to recognise, and returning the entire tree would make the
 * no-results branch indistinguishable from the unfiltered one.
 */
export function filterTree(tree: NavigationTree, query: string): FilterHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: FilterHit[] = [];
  for (const { module, section } of flattenTree(tree)) {
    const matchIndex = section.label.toLowerCase().indexOf(needle);
    if (matchIndex >= 0) {
      hits.push({ module, section, matchIndex });
    } else if (matchesModule(module, needle)) {
      // The heading matched, so every section under it is reachable by that query.
      // `-1` keeps these below every label match in the ranking below.
      hits.push({ module, section, matchIndex: -1 });
    }
  }

  return hits.sort((a, b) => {
    const aPrefix = a.matchIndex === 0;
    const bPrefix = b.matchIndex === 0;
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;

    const aLabel = a.matchIndex >= 0;
    const bLabel = b.matchIndex >= 0;
    if (aLabel !== bLabel) return aLabel ? -1 : 1;

    if (aLabel && bLabel && a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    return 0;
  });
}

/**
 * The hits regrouped under their module, for a filtered tree that keeps its shape.
 *
 * The flat ranked list is the right model for "press Enter to open the best match";
 * this is the right model for *drawing* the result, because a filtered tree that
 * suddenly renders as a flat list is a different component appearing mid-keystroke.
 * Module order follows the tree, not the ranking — the rows move, the headings don't.
 */
export function groupHitsByModule(
  tree: NavigationTree,
  hits: FilterHit[],
): { module: TreeModule; sections: TreeSection[] }[] {
  const bySlug = new Map<string, TreeSection[]>();
  for (const hit of hits) {
    const existing = bySlug.get(hit.module.slug);
    if (existing) existing.push(hit.section);
    else bySlug.set(hit.module.slug, [hit.section]);
  }

  return tree.modules
    .filter((module) => bySlug.has(module.slug))
    .map((module) => ({ module, sections: bySlug.get(module.slug) ?? [] }));
}
