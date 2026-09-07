// Use-cases for CSV Analysis custom views: build one, edit it, enable/disable it,
// delete it, and read a page of an entry's table through it.
//
// The query itself is compiled by view-query.ts (pure) and executed by the repository.
// What lives here is the rules that decide whether a definition is allowed to be saved
// and which views an entry is allowed to offer.
import type { CsvAnalyticsRepository } from "./ports";
import {
  createCsvCustomViewSchema,
  readCustomViewPageSchema,
  updateCsvCustomViewSchema,
  type CreateCsvCustomViewInput,
  type ReadCustomViewPageInput,
  type UpdateCsvCustomViewInput,
} from "./schema";
import type { CsvCustomView, CsvViewCriterion, CsvViewOrderBy, CsvViewPage } from "./types";
import {
  CSV_VIEW_OPERATOR_LABELS,
  findIncompleteCriteria,
  findUnknownColumns,
} from "./view-query";

/** Every view for one entry, disabled ones included — this is the builder's list. */
export function listCustomViews(repo: CsvAnalyticsRepository, entryId: number): CsvCustomView[] {
  return repo.listCustomViews(entryId);
}

/** Every view across every entry, for the Custom Views screen's grid. */
export function listAllCustomViews(repo: CsvAnalyticsRepository): CsvCustomView[] {
  return repo.listAllCustomViews();
}

/**
 * The views an entry may actually offer in its dropdown: enabled only.
 *
 * A disabled view stays editable on the builder screen but drops out of here, so an
 * entry card never offers one. A card still holding a now-disabled selection falls
 * back to the raw table — `readCustomViewPage` is what refuses it, below.
 */
export function listEnabledCustomViews(
  repo: CsvAnalyticsRepository,
  entryId: number,
): CsvCustomView[] {
  return repo.listCustomViews(entryId).filter((view) => view.isEnabled);
}

export function getCustomViewById(
  repo: CsvAnalyticsRepository,
  id: number,
): CsvCustomView | undefined {
  return repo.getCustomViewById(id);
}

/**
 * Validates a definition against the entry it belongs to.
 *
 * Three rules, all of which would otherwise store something that silently does the
 * wrong thing later:
 *   - every referenced column must exist on the entry *now* (a view is built against
 *     a known schema; a typo'd column would just be ignored at read time);
 *   - every criterion must fill its operator's arity, so a saved criterion always
 *     filters on what the user actually typed;
 *   - order-by may not name the same column twice — SQLite accepts it and the second
 *     mention does nothing, which reads as a bug in the builder.
 */
function assertDefinitionFitsEntry(
  repo: CsvAnalyticsRepository,
  entryId: number,
  definition: {
    selectedColumns: string[];
    criteria: CsvViewCriterion[];
    orderBy: CsvViewOrderBy[];
  },
): void {
  const entry = repo.getEntryById(entryId);
  if (!entry) throw new Error(`CSV analytic entry ${entryId} not found.`);

  const unknown = findUnknownColumns(entry.columns, definition);
  if (unknown.length > 0) {
    throw new Error(
      `"${entry.name}" has no column named ${unknown.map((name) => `"${name}"`).join(", ")}.`,
    );
  }

  const incomplete = findIncompleteCriteria(definition.criteria);
  if (incomplete.length > 0) {
    const first = incomplete[0];
    throw new Error(
      `The criterion on "${first.column}" (${CSV_VIEW_OPERATOR_LABELS[first.operator]}) needs a value.`,
    );
  }

  const orderColumns = definition.orderBy.map((order) => order.column);
  const duplicate = orderColumns.find((name, index) => orderColumns.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`"${duplicate}" appears twice in the order by — remove one.`);
  }
}

/** Rejects a name already used by another view on the same entry. */
function assertNameFree(
  repo: CsvAnalyticsRepository,
  entryId: number,
  name: string,
  excludingId?: number,
): void {
  if (repo.isCustomViewNameTaken(entryId, name, excludingId)) {
    throw new Error(`A custom view named "${name}" already exists for this dataset.`);
  }
}

export function createCustomView(
  repo: CsvAnalyticsRepository,
  input: CreateCsvCustomViewInput,
): CsvCustomView {
  const validated = createCsvCustomViewSchema.parse(input);
  assertDefinitionFitsEntry(repo, validated.entryId, validated);
  assertNameFree(repo, validated.entryId, validated.name);
  return repo.createCustomView(validated);
}

export function updateCustomView(
  repo: CsvAnalyticsRepository,
  id: number,
  input: UpdateCsvCustomViewInput,
): CsvCustomView {
  const existing = repo.getCustomViewById(id);
  if (!existing) throw new Error(`Custom view ${id} not found.`);

  const validated = updateCsvCustomViewSchema.parse(input);
  // The entry is the existing view's, never the caller's — a view can't be moved,
  // because its column references only mean something against one schema.
  assertDefinitionFitsEntry(repo, existing.entryId, validated);
  assertNameFree(repo, existing.entryId, validated.name, id);
  return repo.updateCustomView(id, validated);
}

/** Enables or disables a view without touching the rest of its definition. */
export function setCustomViewEnabled(
  repo: CsvAnalyticsRepository,
  id: number,
  isEnabled: boolean,
): CsvCustomView {
  const existing = repo.getCustomViewById(id);
  if (!existing) throw new Error(`Custom view ${id} not found.`);
  return repo.setCustomViewEnabled(id, isEnabled);
}

export function deleteCustomView(repo: CsvAnalyticsRepository, id: number): void {
  repo.deleteCustomView(id);
}

/**
 * Reads one page of an entry's table through a view.
 *
 * A disabled view is refused here rather than served: disabling is meant to take a
 * view out of circulation, so a stale selection on a card must not keep working. The
 * caller (the entry card) treats the failure as "fall back to the raw table".
 */
export function readCustomViewPage(
  repo: CsvAnalyticsRepository,
  input: ReadCustomViewPageInput,
): CsvViewPage {
  const validated = readCustomViewPageSchema.parse(input);
  const view = repo.getCustomViewById(validated.viewId);
  if (!view) throw new Error(`Custom view ${validated.viewId} not found.`);
  if (!view.isEnabled) throw new Error(`The custom view "${view.name}" is disabled.`);
  return repo.readCustomViewPage(view, validated.page);
}
