// Canonicalizes the free-text time a journal entry carries. Entry time has
// always been an unvalidated string, and two imports of the same events wrote
// it in two shapes ("15:30" and "15:30:00"), which made every row look new to
// the importer's date+time+title duplicate check. Normalizing on the way in
// means the check compares like with like.

/**
 * Returns `value` as canonical 24-hour `HH:MM`.
 *
 * Drops a seconds component and zero-pads the hour, so "15:30:00" and "9:05"
 * become "15:30" and "09:05". An empty string stays empty — most entries carry
 * no time and that is a legitimate value, not a missing one.
 *
 * A value this can't read is returned trimmed but otherwise untouched. Entry
 * time has never been validated, so rejecting it here would newly break an
 * import that works today; preserving what the reader typed loses less than
 * throwing does.
 */
export function normalizeEntryTime(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";

  // HH:MM, optionally followed by :SS. Seconds are truncated rather than
  // rounded — no stored entry uses them to mean anything.
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return trimmed;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return trimmed;

  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}
