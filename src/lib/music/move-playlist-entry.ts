/**
 * Moving one playlist entry up or down, as a pure list transform.
 *
 * Lives here rather than in the view because it is logic: the screen decides *that*
 * a row moved, this decides what the new order is. It takes the ordered entry ids and
 * returns a new array, so the caller can hand the result straight to
 * `reorderPlaylistAction` -- which rewrites positions wholesale rather than taking a
 * from/to pair, for the same reason `reorderPlaylistSchema` does.
 *
 * Ids here are playlist ENTRY ids (`mus_playlist_tracks.id`), not track ids: a playlist
 * may hold the same track twice, and the two copies must move independently.
 *
 * A move that would fall off either end returns the list unchanged rather than
 * throwing. The buttons are disabled at the ends anyway, so an out-of-range move is a
 * race (a second click landing after a reload), not a caller error -- and the caller
 * comparing identity is a cheaper way to notice than a try/catch.
 */
export function movePlaylistEntry(
  orderedEntryIds: readonly number[],
  entryId: number,
  direction: "up" | "down",
): number[] {
  const index = orderedEntryIds.indexOf(entryId);
  if (index === -1) return [...orderedEntryIds];

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= orderedEntryIds.length) return [...orderedEntryIds];

  const next = [...orderedEntryIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
