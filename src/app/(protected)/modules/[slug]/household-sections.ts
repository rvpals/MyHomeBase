// The Household module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from a client module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like HOUSEHOLD_SECTION_INFO[section] would come back
// undefined. Same reasoning as tools-sections.ts and journal-sections.ts.

// `configuration` is last on purpose: the shell draws Home first, then the two group
// headings, then Configuration — the usual "settings at the bottom" place. It is
// admin-only; see household-section.tsx.
export const HOUSEHOLD_SECTIONS = ["main", "recipes", "recipes-import", "hsa", "configuration"] as const;

export type HouseholdSection = (typeof HOUSEHOLD_SECTIONS)[number];

/**
 * The module's two halves, each rendered as a group heading over its own sections.
 *
 * This is how "submodules" are expressed here: there is no third level between a
 * module and a section, so Recipes and HSA Tracker are `children` nodes in the tree
 * (and labelled groups in the compact bar), exactly as Journal's Locations and
 * Configuration groups are. A heading is a label, not a destination — it carries no
 * href, and `SectionPanel` drops it from the compact sheet.
 *
 * Each list has one entry today. That is the point of declaring them as lists: the
 * second Recipes screen is one string here plus a route branch, with no navigation
 * work, and the HSA Tracker's real sections replace its placeholder the same way.
 */
export const HOUSEHOLD_RECIPE_SECTIONS = [
  "recipes",
  // Second, because it writes what the row above reads. The slug is permanent:
  // `SectionPanel` derives the icon slot id from it, so renaming it would
  // orphan any uploaded override.
  "recipes-import",
] as const satisfies readonly HouseholdSection[];

export const HOUSEHOLD_HSA_SECTIONS = ["hsa"] as const satisfies readonly HouseholdSection[];

export function isHouseholdSection(value: string): value is HouseholdSection {
  return (HOUSEHOLD_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const HOUSEHOLD_SECTION_INFO: Record<
  HouseholdSection,
  { label: string; description: string }
> = {
  main: {
    label: "Home screen",
    description: "What the household keeps track of here.",
  },
  recipes: {
    label: "Recipes",
    description: "The recipe box — what to cook, and how you made it last time.",
  },
  "recipes-import": {
    label: "Import",
    description: "Bring recipes in from a CSV, mapping its columns onto the recipe fields.",
  },
  hsa: {
    // The label was "Overview" while this was a placeholder. The slug `hsa` and its
    // icon slot are unchanged — only the label is free to move.
    label: "Receipts",
    description: "Every HSA expense, its receipt, and whether it has been reimbursed.",
  },
  configuration: {
    label: "Configuration",
    description: "Where HSA receipts are filed, and the cards offered in Paid with.",
  },
};

/**
 * Section -> nav icon key, resolved by TreeIcon.
 *
 * All three are real TREE_ICONS concepts — an invented key renders NOTHING rather
 * than falling back to a default. `recipe` and `receipt` were added with this
 * module; see src/lib/icons/tree-icon-names.ts.
 */
export const HOUSEHOLD_SECTION_ICONS: Record<HouseholdSection, string> = {
  main: "grid",
  // `list` rather than `recipe`: the group heading above this row already wears the
  // chef's hat, and two identical glyphs stacked would obscure the nesting.
  recipes: "list",
  // `upload`, matching Journal's import row — the concept is "a file comes in",
  // not "a recipe", and the group heading above already wears the chef's hat.
  "recipes-import": "upload",
  // `clipboard` rather than a second `receipt`: the group heading above wears the
  // till slip, and a row repeating its parent's glyph obscures the nesting.
  hsa: "clipboard",
  // `gear`, the configuration glyph.
  configuration: "gear",
};

/** The group headings' own labels, hints and icons. Not destinations. */
export const HOUSEHOLD_GROUPS = {
  recipes: {
    // `recipes-group`, not `recipes` — the child section already owns that slug, and
    // `SectionPanel` derives each node's icon slot from its id
    // (`household_section_recipes_group` vs `household_section_recipes`). Journal's
    // `locations-group` records the same collision.
    id: "recipes-group",
    label: "Recipes",
    hint: "The recipe box.",
    icon: "recipe",
  },
  hsa: {
    id: "hsa-group",
    label: "HSA Tracker",
    hint: "The health savings account.",
    // `receipt`, a TREE concept. Deliberately not `wallet`: that is a MODULE icon
    // name (Expense's), and nothing in this record resolves against that table —
    // an unknown tree key renders nothing rather than falling back.
    icon: "receipt",
  },
} as const;

const BASE_PATH = "/modules/household";

/** The home screen is the module root; every other section is a child route. */
export function householdSectionHref(section: HouseholdSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
