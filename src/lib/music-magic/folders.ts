// Folder criteria: turning a picked folder path into something the catalog can match.
//
// A folder is not an entity in this schema -- `mus_tracks.relative_path` is the only
// record that folders exist at all -- so a folder criterion is stored as a path string,
// exactly as genres and artists are stored as tag strings (see migrations/0060). These
// are the pure rules for reading such a string; the SQL that applies them lives in
// repository.ts.

/**
 * A picked folder matches its whole SUBTREE, not just the files sitting directly in it.
 *
 * This is the load-bearing decision of the whole feature and the reason drilling down is
 * worth having: picking `Rock` means "anything under Rock", and drilling in to pick
 * `Rock/Queen` narrows that to one artist's folder. If a pick meant "only files directly
 * here", then picking a folder that contains nothing but sub-folders -- which is most of
 * the interesting ones, a genre folder or a library root -- would select zero tracks, and
 * the tree would be a browser you cannot actually choose from.
 */
export const FOLDER_MATCH_IS_SUBTREE = true;

/**
 * The `LIKE` pattern that matches a folder and everything beneath it.
 *
 * `'' -> '%'` is deliberate: the empty path is the library root, and the root's subtree
 * is the whole catalog. It is never STORED as a criterion (picking "All music" is the
 * same as picking nothing, and the view offers no checkbox for it), but a stored criteria
 * array can outlive the folders it names and hand-edited rows happen, so the degenerate
 * case resolves to something harmless rather than to a pattern that matches nothing.
 *
 * Underscores and percent signs in a real folder name are NOT escaped, and that is a
 * knowing trade: `_` is a single-character wildcard in SQL LIKE, so a folder literally
 * named `Rock_1` would also match `Rock 1`. Escaping needs a matching `ESCAPE` clause on
 * every predicate, and the failure here is over-matching a neighbour folder by one
 * character -- the same benign over-match the rest of this module's search already
 * accepts. Noted rather than fixed.
 */
export function folderLikePattern(relativePath: string): string {
  const trimmed = stripTrailingSlashes(relativePath);
  return trimmed === "" ? "%" : `${trimmed}/%`;
}

/**
 * What to show for a folder path: its last segment.
 *
 * The full path is what gets stored and matched, but a chip reading
 * `Music/Rock/Queen/Greatest Hits` is unreadable at picker width, and the breadcrumb
 * above it already says where you are. Falls back to the whole path when there is no
 * segment to take -- so this never returns ''.
 */
export function folderLabel(relativePath: string): string {
  const trimmed = stripTrailingSlashes(relativePath);
  if (trimmed === "") return "(library root)";
  const segments = trimmed.split("/");
  return segments[segments.length - 1] ?? trimmed;
}

/** The parent path of a folder, or '' when it sits at the root. */
export function folderParent(relativePath: string): string {
  const trimmed = stripTrailingSlashes(relativePath);
  const cut = trimmed.lastIndexOf("/");
  return cut === -1 ? "" : trimmed.slice(0, cut);
}

/** Whether `candidate` is `ancestor` itself or sits beneath it. */
export function isFolderWithin(candidate: string, ancestor: string): boolean {
  const child = stripTrailingSlashes(candidate);
  const parent = stripTrailingSlashes(ancestor);
  if (parent === "") return true;
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

/**
 * Drops any picked folder that another pick already covers.
 *
 * Because a pick means its whole subtree, `[Rock, Rock/Queen]` and `[Rock]` select
 * exactly the same tracks -- the second entry is not a narrowing, it is a no-op. Pruning
 * it matters for two reasons beyond tidiness:
 *
 *  - The live candidate count would otherwise be built from redundant predicates, and
 *    while `OR` is idempotent so the COUNT stays right, every redundant entry is a bound
 *    parameter against `MAX_CRITERIA_VALUES` and SQLite's real parameter ceiling.
 *  - A saved list should record what the listener MEANT. Reopening one that stores both
 *    would tick a parent and a child and invite the reading that the child is doing
 *    something, which it is not.
 *
 * Order of the survivors follows the input, so the chip list does not reshuffle when a
 * pick is pruned. Case-sensitive comparison: `relative_path` is matched NOCASE in SQL,
 * but two paths differing only in case come from one real folder on disk, so treating
 * them as distinct here is harmless -- the SQL still collapses them.
 */
export function pruneRedundantFolders(folders: readonly string[]): string[] {
  const cleaned = folders.map(stripTrailingSlashes).filter((path) => path !== "");
  // Deduplicated first so an exact repeat does not survive by being "within itself".
  const unique = [...new Set(cleaned)];
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isFolderWithin(path, other)),
  );
}

/** `Rock/Queen/` -> `Rock/Queen`. Paths arrive from SQL and from a form; both can trail. */
function stripTrailingSlashes(relativePath: string): string {
  return relativePath.replace(/\/+$/, "");
}
