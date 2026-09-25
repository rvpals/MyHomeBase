import type { SavedQueryRepository } from "./ports";
import { savedQueryIdSchema, saveQuerySchema } from "./schema";
import type { SavedQuery } from "./types";

/** Every saved statement, ordered by name — the whole "Saved SQL" card. */
export function listSavedQueries(repo: SavedQueryRepository): SavedQuery[] {
  return repo.listSavedQueries();
}

/**
 * Saves a statement under a name, replacing whatever held that name before.
 *
 * `sys_saved_sql_queries` is UNIQUE (name), so this is one upsert rather than a
 * create/update branch — the caller never has to know whether the row already
 * existed. Replacing is the documented behaviour, not an accident: the save
 * dialog warns before overwriting.
 *
 * The raw input is parsed here rather than in each adapter, which is what lets
 * the web form and the CLI hand in the same comma-separated tag string and get
 * the same stored row.
 */
export function saveQuery(repo: SavedQueryRepository, input: unknown): SavedQuery {
  return repo.upsertSavedQuery(saveQuerySchema.parse(input));
}

/**
 * Deletes a saved query by id.
 *
 * Throws when no row had that id, rather than returning quietly. A delete that
 * matched nothing means the caller's list was stale — two admins on the same
 * card, say — and reporting that as success would leave a row on screen that
 * the reader believes they just removed.
 */
export function deleteSavedQuery(repo: SavedQueryRepository, id: unknown): void {
  const validated = savedQueryIdSchema.parse(id);
  if (!repo.deleteSavedQuery(validated)) {
    throw new Error(`No saved query with id ${validated}.`);
  }
}
