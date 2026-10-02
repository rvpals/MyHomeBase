// One reader's own show/hide for each toolbar.
//
// Deliberately NOT a column on `sys_toolbars`: that table is the administrator's,
// and this is per-person. A row per (toolbar, reader) would need cleaning up on
// both deletions to store a set of small integers, so this is one preference key
// holding a comma-separated id list — exactly the shape `nav_expanded_modules`
// uses, and bounded the same way (by the toolbars that exist).
//
// **Stored as the HIDDEN set, not the visible one.** That asymmetry is load-bearing:
// a reader who has never touched this has no row, and an empty value has to mean
// "show me everything the admin published" rather than "show me nothing". Storing
// the visible set would make a new toolbar invisible to every existing reader until
// they each went and ticked it, which is the opposite of what publishing one means.

/** The preference key the hidden list lives under. */
export const TOOLBARS_HIDDEN_PREFERENCE_KEY = "toolbars_hidden";

/**
 * The hidden ids, parsed from the stored value.
 *
 * Unknown and malformed entries are dropped rather than throwing: a deleted toolbar
 * leaves its id behind in every reader's row, and a screen that crashed on a stale
 * entry would be unfixable through the UI — the one place you would go to fix it.
 * Same rule `parseEnabledFloating` applies, and for the same reason.
 */
export function parseHiddenToolbars(value: string | undefined): number[] {
  if (!value) return [];
  const seen = new Set<number>();
  for (const part of value.split(",")) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0) seen.add(id);
  }
  return [...seen].sort((a, b) => a - b);
}

/** The hidden list as stored. Sorted, so a round trip never looks like a change. */
export function serializeHiddenToolbars(ids: readonly number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(",");
}

/**
 * Hides or shows one toolbar for one reader, returning the new hidden list.
 *
 * Takes and returns the whole list rather than mutating, so the caller writes one
 * preference key with `setValue` — never through `userPreferencesToEntries`, which
 * writes every key it carries and would let a stale tab clobber an unrelated
 * preference. Same reasoning as `saveFloatingState`.
 */
export function setToolbarHidden(
  hiddenIds: readonly number[],
  toolbarId: number,
  hidden: boolean,
): number[] {
  const next = new Set(hiddenIds);
  if (hidden) next.add(toolbarId);
  else next.delete(toolbarId);
  return [...next].sort((a, b) => a - b);
}
