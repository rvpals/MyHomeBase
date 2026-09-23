import type { Module } from "../modules/types";
import type { ModuleTableGroup } from "./types";
import { describeTable } from "./table-reference";

/**
 * Which module owns a table, by its three-letter prefix.
 *
 * The prefix convention is `coding-guide.md`'s; this maps each one to the
 * *module slug* in `sys_modules`, so the group heading can come from the live
 * registry rather than being spelled here. That matters because a module can be
 * renamed on the Modules admin screen — keying on the slug means the heading
 * follows the rename, and keying on a prefix (which a migration fixes forever)
 * means the mapping never has to change when it does.
 *
 * `table-reference.ts` has a prefix list too, but its `module` field is display
 * prose — "Platform", "Icon customisation" — for tables that have no module at
 * all. This map is deliberately only the *real* modules; everything else lands
 * in "Non-Modules" below.
 */
const MODULE_SLUG_BY_PREFIX: Record<string, string> = {
  inv_: "investments",
  jrn_: "journal",
  csv_: "csv-analysis",
  exp_: "expense",
  att_: "attendance",
  mus_: "music-library",
  gam_: "games",
  pho_: "picture-gallery",
  tol_: "tools",
};

/** The heading for everything no module owns. */
const NON_MODULES_LABEL = "Non-Modules";

/**
 * The prefix of a table name, including the underscore — "inv_" from
 * "inv_tax_lots". Empty when the name has no prefix in the convention's shape,
 * which is how `sqlite_master`'s own oddities and any hand-made table fall
 * through to "Non-Modules" rather than inventing a group.
 */
function prefixOf(tableName: string): string {
  const separator = tableName.indexOf("_");
  if (separator !== 3) return "";
  return tableName.slice(0, separator + 1);
}

/**
 * Every table grouped by the module that owns it, for the Modules tab.
 *
 * `modules` is the live `sys_modules` list, and drives both the group headings
 * and their order — so the tab reads in the same sequence as the nav rail. A
 * module with no tables is kept with an empty `tables` array rather than
 * dropped: "Games owns no tables yet" is a fact worth showing, and it matches
 * how the schema tree keeps an empty "Views" node.
 *
 * Anything left over — the `sys_` platform tables, `ico_` icon overrides, the
 * runtime-created `csv_` dataset tables, and any table whose prefix maps to a
 * module that isn't registered — goes into a single trailing "Non-Modules"
 * group. A table can therefore never be hidden by this view, only relocated.
 */
export function groupTablesByModule(
  tableNames: string[],
  modules: Module[],
): ModuleTableGroup[] {
  const sorted = [...tableNames].sort((left, right) => left.localeCompare(right));
  const bySlug = new Map<string, string[]>();
  const leftovers: string[] = [];
  const registeredSlugs = new Set(modules.map((module) => module.slug));

  for (const tableName of sorted) {
    const slug = MODULE_SLUG_BY_PREFIX[prefixOf(tableName)];
    // A prefix that maps to a module nobody registered is a leftover, not a
    // group of its own — otherwise deleting a module would silently orphan its
    // tables out of the view entirely.
    if (!slug || !registeredSlugs.has(slug)) {
      leftovers.push(tableName);
      continue;
    }
    const existing = bySlug.get(slug);
    if (existing) existing.push(tableName);
    else bySlug.set(slug, [tableName]);
  }

  const groups: ModuleTableGroup[] = [...modules]
    .sort((left, right) => left.sequence - right.sequence)
    .map((module) => ({
      key: module.slug,
      label: module.shortName,
      prefix: prefixForSlug(module.slug),
      icon: module.icon,
      isModule: true,
      tables: (bySlug.get(module.slug) ?? []).map(toRow),
    }));

  groups.push({
    key: "non-modules",
    label: NON_MODULES_LABEL,
    prefix: "",
    isModule: false,
    tables: leftovers.map(toRow),
  });

  return groups;
}

/** The prefix a module's tables carry, or empty when it owns none by convention. */
function prefixForSlug(slug: string): string {
  const found = Object.entries(MODULE_SLUG_BY_PREFIX).find(([, mapped]) => mapped === slug);
  return found ? found[0] : "";
}

function toRow(tableName: string) {
  return { name: tableName, description: describeTable(tableName) };
}
