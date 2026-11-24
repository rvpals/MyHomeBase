import {
  applyTaxonomyCombo,
  deleteTaxonomyCombo,
  describeTaxonomyCombo,
  getTaxonomyComboByName,
  listTaxonomyCombos,
  saveTaxonomyCombo,
  searchTaxonomyCombos,
  type JournalTaxonomyCombo,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Journal taxonomy combos from the terminal — the same use-cases the Meta Data
 * screen's "Prefill Tags & Category Combo" tab drives.
 *
 *   journal-combos list
 *   journal-combos list --search gym
 *   journal-combos show   --name "Gym"
 *   journal-combos apply  --name "Gym"
 *   journal-combos set    --name "Gym" --categories "HEALTH,SPORT" --tags "gym weights"
 *   journal-combos set    --name "Gym" --description "Weights day."
 *   journal-combos delete --name "Gym"
 *
 * `apply` prints the two lists an entry would end up with — which is the proof
 * that the replace really lives in `src/lib/`, since this file only prints.
 *
 * `set` is an upsert of the whole combo, creating it if it does not exist. Unlike
 * `journal-templates set` (one field per invocation, because a template's field
 * list is unbounded) a combo has only four fields, so taking them all at once is
 * the shorter road. An omitted `--categories` or `--tags` leaves that list as it
 * was; `--categories ""` clears it, which is a real value — applying a combo with
 * an empty list clears that field on the entry (migration 0177).
 */
export async function journalCombosCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list":
      return printList(flags.search);
    case "show":
      return printOne(flags.name);
    case "apply":
      return printApplied(flags.name);
    case "set":
      return setCombo(flags);
    case "delete":
      return remove(flags.name);
    default:
      console.error(`Unknown subcommand "${subcommand ?? "(none)"}".`);
      console.error("Use: list | show | apply | set | delete");
      process.exitCode = 1;
  }
}

function printOneTo(combo: JournalTaxonomyCombo): void {
  console.log(combo.name);
  if (combo.description !== "") console.log(`  ${combo.description}`);
  console.log(`  ${describeTaxonomyCombo(combo)}`);
}

function printList(search: string | undefined): void {
  const all = listTaxonomyCombos(deps.journalRepo);
  // The same matching rule the picker's search box applies — see
  // searchTaxonomyCombos on why that lives in lib rather than in either caller.
  const combos = search ? searchTaxonomyCombos(all, search) : all;
  if (combos.length === 0) {
    console.log(search ? `No combo matches "${search}".` : "No combos.");
    return;
  }
  for (const combo of combos) {
    printOneTo(combo);
    console.log("");
  }
}

/** Looks a combo up, reporting and exiting non-zero when it isn't found. */
function mustFind(name: string | undefined): JournalTaxonomyCombo | undefined {
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return undefined;
  }
  const combo = getTaxonomyComboByName(deps.journalRepo, name);
  if (!combo) {
    console.error(`No combo named "${name}".`);
    process.exitCode = 1;
    return undefined;
  }
  return combo;
}

function printOne(name: string | undefined): void {
  const combo = mustFind(name);
  if (!combo) return;
  printOneTo(combo);
}

function printApplied(name: string | undefined): void {
  const combo = mustFind(name);
  if (!combo) return;
  const selection = applyTaxonomyCombo(combo);
  // Printed as "(cleared)" rather than as a blank line, because an empty list is
  // a real instruction here and a blank line would read as a bug.
  console.log(`Categories   ${selection.categories.join(", ") || "(cleared)"}`);
  console.log(`Tags         ${selection.tags.join(", ") || "(cleared)"}`);
}

/**
 * Splits a flag's value into names.
 *
 * Comma **or** whitespace, for both lists, because a shell makes quoting commas
 * awkward and the two separators cannot be confused here — no category or tag
 * name in this journal contains either. (The web form has no such problem: it
 * collects chips.)
 */
function splitNames(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function setCombo(flags: Record<string, string>): void {
  const name = flags.name;
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return;
  }

  const existing = getTaxonomyComboByName(deps.journalRepo, name);

  // Presence of the key, not truthiness of the value: `--categories ""` must
  // clear the list, and an omitted flag must leave it alone. Those are different
  // instructions and `flags.categories || existing` would conflate them.
  const categories =
    "categories" in flags ? splitNames(flags.categories ?? "") : (existing?.categories ?? []);
  const tags = "tags" in flags ? splitNames(flags.tags ?? "") : (existing?.tags ?? []);

  try {
    const saved = saveTaxonomyCombo(deps.journalRepo, {
      id: existing?.id,
      name: existing?.name ?? name,
      description: flags.description ?? existing?.description ?? "",
      categories,
      tags,
    });
    console.log(`Saved "${saved.name}".`);
    console.log(`  ${describeTaxonomyCombo(saved)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function remove(name: string | undefined): void {
  const combo = mustFind(name);
  if (!combo) return;
  deleteTaxonomyCombo(deps.journalRepo, combo.id);
  console.log(`Deleted "${combo.name}".`);
}
