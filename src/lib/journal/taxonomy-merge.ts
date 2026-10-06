// Folding several categories or tags into one name — the Meta Data card's bulk
// Merge, and the `journal-taxonomy --merge` CLI command.
//
// Both managed lists fill themselves from whatever an entry or an import
// mentions, so the same idea arrives under several spellings: "Trips",
// "Vacation", "Holidays". Merge is how those become one name without editing
// every entry by hand.
//
// **A merge is not undoable.** There is no recycle bin for taxonomy — once the
// sources are folded in, which entry carried which original name is gone. The
// callers say so before they write; this module does not try to make it
// recoverable.
//
// What a merge touches, and why the last two are not optional:
//
//   * every entry pairing carrying a source  (the point of the operation)
//   * the managed list rows themselves
//   * saved entry filters that name a source
//   * prefill templates that name a source
//
// The last two are stored as JSON blobs rather than as foreign keys, so nothing
// in the database follows a rename for us. Skipping them would leave a saved
// filter reading "category is Trips" silently matching no entries, which is a
// worse failure than an error — it looks like an empty journal.

import {
  mergeTaxonomySchema,
  type MergeTaxonomyInput,
  type PrefillTemplateWriteData,
} from "./schema";
import type { JournalRepository } from "./ports";
import type {
  JournalFilter,
  JournalFilterCondition,
  JournalPrefillFieldValue,
  JournalPrefillTemplate,
  SavedJournalFilter,
} from "./types";
import { normalizeTaxonomyName, type TaxonomyUsageKind } from "./taxonomy-usage";

/** The filter fields that hold a category/tag name. */
const TAXONOMY_FILTER_FIELD: Record<TaxonomyUsageKind, string> = {
  category: "category",
  tag: "tag",
};

/** The prefill field that holds a comma-separated list of them. */
const TAXONOMY_PREFILL_FIELD: Record<TaxonomyUsageKind, string> = {
  category: "categories",
  tag: "tags",
};

/** How a prefill template joins several names into one string. */
const PREFILL_DELIMITER = ", ";

/** What a merge would do, shown in the dialog before anything is written. */
export interface TaxonomyMergePlan {
  /** The names being folded in, excluding the target itself. */
  sources: string[];
  /** The name they become, trimmed. */
  target: string;
  /** True when `target` is already in the managed list. */
  targetExists: boolean;
  /** How many entries will carry `target` once the merge lands. */
  entryCount: number;
  /** Names of the saved filters this merge would rewrite. */
  affectedFilters: string[];
  /** Names of the prefill templates this merge would rewrite. */
  affectedTemplates: string[];
  /**
   * The icon the merged name will end up with, when that is inherited rather
   * than kept. Undefined when the target already exists (it keeps its own) or
   * when no single source supplies one.
   */
  inheritedIconFrom?: string;
}

/** What a completed merge did. */
export interface TaxonomyMergeResult {
  target: string;
  mergedCount: number;
  entryCount: number;
  rewrittenFilters: number;
  rewrittenTemplates: number;
}

/** Case- and whitespace-insensitive equality, the same rule Clean up uses. */
function sameName(a: string, b: string): boolean {
  return normalizeTaxonomyName(a) === normalizeTaxonomyName(b);
}

/**
 * The single name a merge keeps, and the sources it will remove.
 *
 * **The typed text wins, exactly as typed.** Merging "Work" and "WORK" into
 * "WORK" leaves "WORK"; into "Work" leaves "Work"; into "Work Stuff" leaves
 * "Work Stuff" and removes both originals. The reader named the survivor, so
 * the merge does not quietly substitute a different spelling for it.
 *
 * The subtlety that makes this its own function: `"Work"` and `"WORK"` are two
 * distinct rows (SQLite's TEXT primary key is case-sensitive) that normalize
 * alike. An earlier version decided what to delete by comparing *normalized*
 * names, which excluded **both** of them as "the target" — so the merge removed
 * nothing and left "WORK" behind still carrying its entries. Sources are
 * therefore compared by **exact** name: only the row whose name is character-
 * for-character the target survives.
 *
 * `targetExists` likewise means an exact row, since that is the row whose icon
 * and description would be preserved. Merging into "WORK" when only "Work"
 * exists creates "WORK" — a new row, inheriting as any new target does.
 */
function resolveMerge(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  rawSources: string[],
  target: string,
): { resolvedTarget: string; sources: string[]; targetExists: boolean } {
  const managed = managedList(repo, kind);
  return {
    resolvedTarget: target,
    sources: rawSources.filter((source) => source !== target),
    targetExists: managed.some((item) => item.name === target),
  };
}

/** The managed list for one kind. */
function managedList(repo: JournalRepository, kind: TaxonomyUsageKind) {
  return kind === "category" ? repo.listCategories() : repo.listTags();
}

/**
 * Rewrites one filter condition's names, returning the condition unchanged when
 * it names none of the sources.
 *
 * Both shapes are handled: `values[]` (the `hasAny`/`hasNone` operators) and the
 * single `value` (`equals` and friends). De-duplicates `values`, since merging
 * two names that appear in the same condition would otherwise leave the target
 * listed twice.
 */
function rewriteCondition(
  condition: JournalFilterCondition,
  field: string,
  sources: string[],
  target: string,
): { condition: JournalFilterCondition; changed: boolean } {
  if (condition.field !== field) return { condition, changed: false };

  let changed = false;
  const next: JournalFilterCondition = { ...condition };

  if (condition.values) {
    const mapped = condition.values.map((value) => {
      if (sources.some((source) => sameName(source, value))) {
        changed = true;
        return target;
      }
      return value;
    });
    // Collapse duplicates the mapping just created, comparing the same loose way.
    const deduped: string[] = [];
    for (const value of mapped) {
      if (!deduped.some((kept) => sameName(kept, value))) deduped.push(value);
    }
    if (deduped.length !== condition.values.length) changed = true;
    next.values = deduped;
  }

  if (condition.value !== undefined && sources.some((source) => sameName(source, condition.value!))) {
    next.value = target;
    changed = true;
  }

  return { condition: next, changed };
}

/** Rewrites a whole filter. Returns undefined when nothing in it changed. */
function rewriteFilter(
  filter: JournalFilter,
  field: string,
  sources: string[],
  target: string,
): JournalFilter | undefined {
  let changed = false;
  const groups = filter.groups.map((group) => ({
    ...group,
    conditions: group.conditions.map((condition) => {
      const result = rewriteCondition(condition, field, sources, target);
      if (result.changed) changed = true;
      return result.condition;
    }),
  }));
  return changed ? { ...filter, groups } : undefined;
}

/**
 * Rewrites a prefill template's categories/tags field, which stores its names as
 * one comma-separated string.
 *
 * Returns undefined when nothing changed. Empty segments are dropped and the
 * result de-duplicated, so merging two names that both appear in one template
 * leaves the target once rather than "Travel, Travel".
 */
function rewritePrefillFields(
  fields: JournalPrefillFieldValue[],
  field: string,
  sources: string[],
  target: string,
): JournalPrefillFieldValue[] | undefined {
  let changed = false;

  const next = fields.map((entry) => {
    if (entry.field !== field || entry.value.trim() === "") return entry;

    const names = entry.value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");

    const mapped = names.map((name) => {
      if (sources.some((source) => sameName(source, name))) {
        changed = true;
        return target;
      }
      return name;
    });

    const deduped: string[] = [];
    for (const name of mapped) {
      if (!deduped.some((kept) => sameName(kept, name))) deduped.push(name);
    }
    if (deduped.length !== names.length) changed = true;

    return { ...entry, value: deduped.join(PREFILL_DELIMITER) };
  });

  return changed ? next : undefined;
}

/**
 * What merging `sources` into `target` would do — the numbers and warnings the
 * dialog shows before the reader commits.
 *
 * Pure apart from reading: nothing here writes. The entry count is computed from
 * the *distinct* entries carrying any source plus those already carrying the
 * target, because an entry carrying two sources must count once — the same
 * de-duplication the repository does with `INSERT OR IGNORE`.
 */
export function planTaxonomyMerge(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  input: MergeTaxonomyInput,
): TaxonomyMergePlan {
  const { sources: rawSources, target } = mergeTaxonomySchema.parse(input);

  // Resolved once, by exact name — see `resolveMerge` for why a normalized
  // comparison here left "WORK" behind when merging it with "Work".
  const { resolvedTarget, sources, targetExists } = resolveMerge(repo, kind, rawSources, target);

  const managed = managedList(repo, kind);
  const entryCount = countEntriesAfterMerge(repo, kind, sources, resolvedTarget);

  const field = TAXONOMY_FILTER_FIELD[kind];
  const affectedFilters = repo
    .listFilters()
    .filter((saved) => rewriteFilter(saved.filter, field, sources, resolvedTarget) !== undefined)
    .map((saved) => saved.name);

  const prefillField = TAXONOMY_PREFILL_FIELD[kind];
  const affectedTemplates = repo
    .listPrefillTemplates()
    .filter(
      (template) =>
        rewritePrefillFields(template.fields, prefillField, sources, resolvedTarget) !== undefined,
    )
    .map((template) => template.name);

  // Only meaningful for a brand-new target; an existing one keeps its own icon.
  const iconSources = targetExists
    ? []
    : managed.filter(
        (item) => item.iconMimeType && sources.some((source) => source === item.name),
      );

  return {
    sources,
    target: resolvedTarget,
    targetExists,
    entryCount,
    affectedFilters,
    affectedTemplates,
    // Exactly one candidate, or none: picking between two different icons would
    // be arbitrary, and the reader can set one afterwards in two clicks.
    inheritedIconFrom: iconSources.length === 1 ? iconSources[0].name : undefined,
  };
}

/**
 * How many distinct entries will carry `target` after the merge.
 *
 * Counted with `COUNT(DISTINCT entry_id)` over the sources *and* the target,
 * never summed per name: merging near-duplicates means entries carrying two of
 * them, and a sum would overstate the figure the reader is deciding on. See
 * `JournalRepository.countDistinctEntriesWithCategories`.
 */
function countEntriesAfterMerge(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  sources: string[],
  target: string,
): number {
  const names = [...sources, target];
  return kind === "category"
    ? repo.countDistinctEntriesWithCategories(names)
    : repo.countDistinctEntriesWithTags(names);
}

/**
 * Folds `sources` into `target`: re-points every entry, rewrites the saved
 * filters and prefill templates that name a source, and removes the source rows
 * from the managed list.
 *
 * The entry re-pointing is one transaction inside the repository (see
 * `JournalRepository.mergeCategories` for why it can't be a plain UPDATE). The
 * filter and template rewrites follow it rather than sharing that transaction:
 * they are separate rows in unrelated tables, and a filter that failed to
 * rewrite is a stale filter, not a corrupt journal.
 */
export function mergeTaxonomy(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  input: MergeTaxonomyInput,
): TaxonomyMergeResult {
  const { sources: rawSources, target } = mergeTaxonomySchema.parse(input);

  // Resolved by exact name, not normalized — merging "Work" with "WORK" depends
  // on telling those two rows apart. See `resolveMerge`.
  const { resolvedTarget, sources } = resolveMerge(repo, kind, rawSources, target);

  // Captured before the merge deletes the source rows, since that is the only
  // moment the icon is still readable.
  const plan = planTaxonomyMerge(repo, kind, { sources: rawSources, target });
  const inherited = plan.inheritedIconFrom
    ? readIcon(repo, kind, plan.inheritedIconFrom)
    : undefined;
  const inheritedDescription = plan.targetExists
    ? undefined
    : managedList(repo, kind).find(
        (item) => item.description.trim() !== "" && sources.some((source) => source === item.name),
      )?.description;

  const entryCount =
    kind === "category"
      ? repo.mergeCategories(sources, resolvedTarget)
      : repo.mergeTags(sources, resolvedTarget);

  // A brand-new target starts empty, so give it whatever the merge inherited.
  // An existing target is left exactly as it was — merging into a category you
  // already set up must not silently restyle it.
  //
  // Writes go to the name as the merge actually stored it, not to `target` as
  // typed: the repository reuses an existing row whose spelling differs only in
  // case (SQLite's TEXT primary key is case-sensitive, so it has to), and
  // writing an icon to the typed casing would miss that row entirely.
  if (!plan.targetExists) {
    if (inheritedDescription !== undefined) {
      const write = { name: resolvedTarget, description: inheritedDescription };
      if (kind === "category") repo.upsertCategory(write);
      else repo.upsertTag(write);
    }
    if (inherited) {
      if (kind === "category") repo.setCategoryIcon(resolvedTarget, inherited);
      else repo.setTagIcon(resolvedTarget, inherited);
    }
  }

  const rewrittenFilters = rewriteSavedFilters(repo, kind, sources, resolvedTarget);
  const rewrittenTemplates = rewriteTemplates(repo, kind, sources, resolvedTarget);

  return {
    target: resolvedTarget,
    mergedCount: sources.length,
    entryCount,
    rewrittenFilters,
    rewrittenTemplates,
  };
}

/** The icon bytes for one managed name, as the repository stores them. */
function readIcon(repo: JournalRepository, kind: TaxonomyUsageKind, name: string) {
  const icon = kind === "category" ? repo.getCategoryIcon(name) : repo.getTagIcon(name);
  return icon ? { data: icon.data, mimeType: icon.mimeType } : undefined;
}

/** Rewrites every saved filter naming a source. Returns how many changed. */
function rewriteSavedFilters(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  sources: string[],
  target: string,
): number {
  if (sources.length === 0) return 0;
  const field = TAXONOMY_FILTER_FIELD[kind];
  let rewritten = 0;

  for (const saved of repo.listFilters() as SavedJournalFilter[]) {
    const next = rewriteFilter(saved.filter, field, sources, target);
    if (!next) continue;
    // saveFilter upserts by name, so this updates the row in place.
    repo.saveFilter({ name: saved.name, filter: next });
    rewritten += 1;
  }
  return rewritten;
}

/** Rewrites every prefill template naming a source. Returns how many changed. */
function rewriteTemplates(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  sources: string[],
  target: string,
): number {
  if (sources.length === 0) return 0;
  const field = TAXONOMY_PREFILL_FIELD[kind];
  let rewritten = 0;

  for (const template of repo.listPrefillTemplates() as JournalPrefillTemplate[]) {
    const fields = rewritePrefillFields(template.fields, field, sources, target);
    if (!fields) continue;
    // Carries the id so this updates rather than creating a second template
    // under the same name.
    const write: PrefillTemplateWriteData = {
      id: template.id,
      name: template.name,
      description: template.description,
      isEnabled: template.isEnabled,
      fields,
    };
    repo.savePrefillTemplate(write);
    rewritten += 1;
  }
  return rewritten;
}
