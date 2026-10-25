// The modules whose icon-slot namespace differs from their slug.
//
// A section's icon slot id is derived from `<namespace>_section_<slug>`, and for
// most modules the namespace *is* the module slug. These four are the exceptions:
// each was registered under a shorter name before it was renamed, and the slot ids
// cannot follow the rename without orphaning every uploaded icon override.
//
// Extracted from `nav-tree.tsx` when `NavTabs`/`SectionStrip` needed the same
// mapping: two copies of this table would drift the moment a fifth exception
// appeared, and the failure mode is silent — the wrong namespace derives an
// unregistered id, which falls back to the generic glyph rather than erroring.
//
// **Entries here are permanent.** Removing one re-points that module's sections at
// a different slot id and orphans the icons a reader uploaded against the old one.
export const SLOT_NAMESPACES: Record<string, string> = {
  investments: "stock",
  "csv-analysis": "csv",
  "music-library": "music",
  "picture-gallery": "gallery",
};

/** The icon-slot namespace for a module slug — the slug itself, unless it is an exception. */
export function slotNamespaceFor(moduleSlug: string): string {
  return SLOT_NAMESPACES[moduleSlug] ?? moduleSlug;
}
