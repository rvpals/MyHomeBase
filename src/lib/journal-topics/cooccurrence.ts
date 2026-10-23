// What else travels with a topic.
//
// Counting, nothing more: of the entries that matched `HSA`, how many also
// carry `Taxes`? `Fidelity`? This is the half of the feature that surfaces
// structure the reader never declared — a tag they always use alongside
// another one is a relationship, even though nothing in the data says so.

import { normalizeTerm } from "./fuzzy";
import type { TopicCooccurrence, TopicEntry } from "./types";

export interface CooccurrenceOptions {
  /**
   * Names to leave out — normally the names that matched the term itself,
   * since "HSA co-occurs with HSA" is noise that would always rank first.
   */
  exclude?: readonly string[];
  /**
   * Drop names appearing on fewer than this many entries. 2 by default: a name
   * shared with exactly one entry is a coincidence, not a pattern, and in a
   * well-tagged journal those are the bulk of the list.
   */
  minCount?: number;
}

/**
 * Tags and categories that appear on the topic's entries, most common first.
 *
 * Ties are broken alphabetically so the list is stable between calls — it is
 * rendered as a ranked list, and names swapping places on refresh reads as a
 * bug.
 *
 * Note `share` is relative to the number of entries *given*, not to the whole
 * journal. "Appears on 80% of this topic's entries" is the useful statement;
 * "appears on 2% of all entries" is a different question and not this one.
 */
export function buildCooccurrence(
  entries: readonly TopicEntry[],
  options: CooccurrenceOptions = {},
): TopicCooccurrence[] {
  const minCount = options.minCount ?? 2;
  const excluded = new Set((options.exclude ?? []).map(normalizeTerm));

  // Keyed by kind + normalized name so that `HSA` and `hsa` count as one row,
  // while a tag and a category of the same name stay separate — they are
  // different things in this journal and collapsing them would overstate both.
  const counts = new Map<string, { name: string; kind: "tag" | "category"; count: number }>();

  const bump = (name: string, kind: "tag" | "category") => {
    const normalized = normalizeTerm(name);
    if (normalized === "" || excluded.has(normalized)) return;
    const key = `${kind}:${normalized}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { name, kind, count: 1 });
    }
  };

  for (const { entry } of entries) {
    // A name repeated on one entry must not count twice — the repository does
    // not guarantee the arrays are deduplicated, and a double-tagged entry
    // would otherwise inflate its own contribution.
    for (const name of new Set(entry.tags)) bump(name, "tag");
    for (const name of new Set(entry.categories)) bump(name, "category");
  }

  const total = entries.length;
  return [...counts.values()]
    .filter((row) => row.count >= minCount)
    .map((row) => ({
      name: row.name,
      kind: row.kind,
      entryCount: row.count,
      share: total === 0 ? 0 : row.count / total,
    }))
    .sort((a, b) => {
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      return a.name.localeCompare(b.name);
    });
}
