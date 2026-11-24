// Journal taxonomy combos: a named pairing of categories and tags that either
// entry editor can fill its two taxonomy fields from in one click.
//
// Storage and the reasoning behind it are in migration 0177; this file holds the
// behaviour. As with prefill templates, the apply step is a pure function so the
// same fill runs in the browser (both entry editors), in the CLI, and in a test.
//
// THE ONE THING THAT MAKES THIS NOT A PREFILL TEMPLATE: applying a combo
// *replaces* both lists, where `applyPrefillTemplate` fills only blanks and never
// overwrites. That difference is the whole point — a combo is the tool for fixing
// an entry that is already tagged, which a fill-only-blanks template cannot do.
// See `applyTaxonomyCombo` below.

import type { JournalRepository } from "./ports";
import { saveTaxonomyComboSchema } from "./schema";
import type { SaveTaxonomyComboInput } from "./schema";
import type { JournalTaxonomyCombo, JournalTaxonomySelection } from "./types";

// --- Applying a combo --------------------------------------------------------

/**
 * The two lists an entry should hold after a combo is picked.
 *
 * **Replace, not merge.** Whatever the entry carried is discarded. You asked for
 * this explicitly and it is the behaviour that makes a combo useful on an entry
 * written months ago — merging would make "apply the Gym combo" mean something
 * different on every entry, depending on what was already there, and there would
 * be no way to *remove* a wrong tag by picking a combo.
 *
 * An empty list in the combo therefore **clears** that field. That is a real,
 * expressible value (migration 0177): "this kind of entry carries no tags".
 *
 * Because this throws work away, the editors confirm before calling it whenever
 * the entry already has categories or tags — the confirmation is presentation, so
 * it lives in the view; the discard rule lives here.
 *
 * Returns fresh arrays, so the caller can hand them straight to `setState`
 * without aliasing the stored combo.
 */
export function applyTaxonomyCombo(combo: JournalTaxonomyCombo): JournalTaxonomySelection {
  return { categories: [...combo.categories], tags: [...combo.tags] };
}

/**
 * A one-line summary of what a combo holds, for a list row and the CLI.
 *
 * Lives here rather than in the view because both the web list and the terminal
 * print it, and they must agree about what a combo "is" — an empty one reads as
 * a sentence, not as an empty string that looks like a rendering bug.
 */
export function describeTaxonomyCombo(combo: JournalTaxonomyCombo): string {
  const parts: string[] = [];
  if (combo.categories.length > 0) parts.push(`Categories: ${combo.categories.join(", ")}`);
  if (combo.tags.length > 0) parts.push(`Tags: ${combo.tags.join(", ")}`);
  if (parts.length === 0) return "Clears both categories and tags.";
  return parts.join(" · ");
}

/**
 * Filters combos for the picker's search box.
 *
 * Matches the name, the description, **and the member names** — searching "gym"
 * should find the combo called "Workout" that carries the GYM tag, because the
 * reader is looking for a set of tags and may well remember a member rather than
 * the name they gave the set. Case-insensitive; a blank query matches everything.
 *
 * Pure and in `lib` rather than inline in the view because it is a rule about
 * what "matching a combo" means, and the CLI's `list --search` applies the same
 * one.
 */
export function searchTaxonomyCombos(
  combos: readonly JournalTaxonomyCombo[],
  query: string,
): JournalTaxonomyCombo[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...combos];
  return combos.filter((combo) =>
    [combo.name, combo.description, ...combo.categories, ...combo.tags].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

// --- Use-cases ---------------------------------------------------------------

export function listTaxonomyCombos(repo: JournalRepository): JournalTaxonomyCombo[] {
  return repo.listTaxonomyCombos();
}

export function getTaxonomyCombo(
  repo: JournalRepository,
  id: number,
): JournalTaxonomyCombo | undefined {
  return repo.getTaxonomyComboById(id);
}

/** By name, case-insensitively — how the CLI addresses a combo. */
export function getTaxonomyComboByName(
  repo: JournalRepository,
  name: string,
): JournalTaxonomyCombo | undefined {
  return repo.getTaxonomyComboByName(name.trim());
}

/**
 * Creates or updates a combo. The input's optional `id` decides which.
 *
 * The name clash is checked here rather than left to the unique index, for the
 * same reason `savePrefillTemplate` does it: the caller gets a sentence instead
 * of a SQLITE_CONSTRAINT, and the check reads the same from the web form and the
 * CLI.
 *
 * A combo naming **no** categories and no tags is allowed. It is not a mistake —
 * applying it clears both fields, which is a legitimate "this kind of entry is
 * untagged" (migration 0177). The editor says as much rather than refusing it.
 */
export function saveTaxonomyCombo(
  repo: JournalRepository,
  input: SaveTaxonomyComboInput,
): JournalTaxonomyCombo {
  const parsed = saveTaxonomyComboSchema.parse(input);

  const clash = repo.getTaxonomyComboByName(parsed.name);
  if (clash && clash.id !== parsed.id) {
    throw new Error(`A combo named "${clash.name}" already exists.`);
  }
  if (parsed.id !== undefined && !repo.getTaxonomyComboById(parsed.id)) {
    throw new Error(`Combo ${parsed.id} no longer exists.`);
  }

  return repo.saveTaxonomyCombo(parsed);
}

/**
 * Deletes a combo. Safe unconditionally: applying one copies names onto an entry
 * and nothing links back, so no entry depends on the combo that tagged it.
 */
export function deleteTaxonomyCombo(repo: JournalRepository, id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`deleteTaxonomyCombo: id must be a positive integer, got ${id}.`);
  }
  repo.deleteTaxonomyCombo(id);
}
