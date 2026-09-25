// Which modules are expanded in the tree, to and from a stored preference string.
//
// Stored in `sys_user_preferences` under one key — a comma-separated slug list —
// rather than a row per module. The set is small, it is always read and written
// whole, and a row per module would mean a migration's worth of cleanup every time
// a module is deleted. Same shape as the floating layer's enabled list.

/** The preference value is a slug list; this is the separator. */
const SEPARATOR = ",";

/**
 * Parse the stored value into a set of module slugs.
 *
 * Tolerant by design: blanks, stray whitespace and duplicates are dropped, and an
 * unparseable value resolves to the empty set rather than throwing. Navigation has
 * to render whatever is stored — a hand-edited preference row should collapse the
 * tree, not break every page behind the login.
 *
 * Slugs are **not** validated against the module list here. A slug for a module the
 * reader can no longer see is harmless (nothing looks it up) and dropping it would
 * silently forget the reader's choice the moment an admin toggles a module off and
 * back on.
 */
export function parseExpandedModules(stored: string | undefined): Set<string> {
  if (!stored) return new Set();
  return new Set(
    stored
      .split(SEPARATOR)
      .map((slug) => slug.trim())
      .filter((slug) => slug.length > 0),
  );
}

/**
 * Serialise the expanded set back to a stored value.
 *
 * Sorted, so the same set always produces the same string — an unsorted join would
 * write a new value on every toggle-and-untoggle round trip and make the rows churn
 * for no change in meaning.
 */
export function serializeExpandedModules(slugs: Iterable<string>): string {
  return [...new Set(slugs)]
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0)
    .sort()
    .join(SEPARATOR);
}

/**
 * The expanded set after toggling one module.
 *
 * Returns a new set rather than mutating: this feeds React state, where mutating a
 * set in place is a re-render that doesn't happen.
 */
export function toggleExpandedModule(expanded: Set<string>, slug: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(slug)) next.delete(slug);
  else next.add(slug);
  return next;
}

/**
 * The set to render with on first paint.
 *
 * The active module is **always** expanded, whatever is stored: a tree whose current
 * section is hidden inside a collapsed heading has nothing highlighted and reads as
 * though navigation has lost track of where you are. This is the tree-level version
 * of `SectionGroup`'s `useState(containsActive)`, except here it is applied on top of
 * a stored set instead of replacing it — so collapsing a module you are *not* in
 * still survives a reload.
 */
export function resolveInitialExpanded(
  stored: Set<string>,
  activeModuleSlug: string | undefined,
): Set<string> {
  if (!activeModuleSlug) return new Set(stored);
  const next = new Set(stored);
  next.add(activeModuleSlug);
  return next;
}
