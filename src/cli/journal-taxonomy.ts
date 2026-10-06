import {
  findUnusedTaxonomy,
  mergeTaxonomy,
  planTaxonomyMerge,
  taxonomyInUseAmong,
  taxonomyUsageCounts,
  type TaxonomyUsageKind,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The Journal → Meta Data card's "Clean up" from the terminal: which managed
 * categories or tags no entry actually uses, and the bulk delete the ticked rows
 * feed.
 *
 *   journal-taxonomy category
 *   journal-taxonomy tag
 *   journal-taxonomy category --unused
 *   journal-taxonomy tag --unused --delete
 *   journal-taxonomy category --merge "Trips,Vacation" --into Travel
 *   journal-taxonomy category --merge "Trips,Vacation" --into Travel --apply
 *
 * Same use-cases the web buttons call — `findUnusedTaxonomy` for the scan and
 * `deleteCategory`/`deleteTag` for the removal — so the two front-ends cannot
 * disagree about which names are unused.
 *
 * Without `--delete` nothing is written, matching the web flow: there, Clean up
 * only *ticks* the rows and the reader presses Delete. `--delete` is that second
 * press, and it is scoped to `--unused` deliberately — deleting a hand-picked
 * list of names from here would be a destructive command with no confirm, where
 * the web path at least spells out what is still in use first.
 *
 * `--merge "a,b" --into "New"` is the card's Merge button: it folds several names
 * into one, following the rename into the saved filters and prefill templates
 * that reference them. It **prints the plan and writes nothing** without
 * `--apply`, matching `journal-same-date --merge` and the web dialog, which shows
 * the same summary before the reader commits. A merge cannot be undone.
 */
export function journalTaxonomyCommand(args: string[]): void {
  const kind = parseKind(args);
  if (kind === undefined) return;

  const flags = parseFlags(args);
  const unusedOnly = args.includes("--unused");
  const doDelete = args.includes("--delete");
  const noun = kind === "category" ? "category" : "tag";
  const plural = kind === "category" ? "categories" : "tags";

  if (flags.merge !== undefined) {
    mergeSelection(kind, flags.merge, flags.into, args.includes("--apply"));
    return;
  }

  if (doDelete && !unusedOnly) {
    console.error(
      "--delete only works with --unused. Run it as: " +
        `journal-taxonomy ${kind} --unused --delete`,
    );
    process.exitCode = 1;
    return;
  }

  // The whole managed list, as the web card reads it — no limit, since a name
  // used by nothing is exactly the one a top-N read would hide.
  const usage = taxonomyUsageCounts(deps.journalRepo, kind);
  if (usage.length === 0) {
    console.log(`No ${plural} in the managed list.`);
    return;
  }

  const unused = findUnusedTaxonomy(deps.journalRepo, kind);

  if (!unusedOnly) {
    console.log(
      `${usage.length} ${usage.length === 1 ? noun : plural} · ` +
        `${unused.length} used by no entry`,
    );
    console.log("");
    const width = Math.max(...usage.map((row) => row.name.length));
    for (const row of usage) {
      const count = row.entryCount === 0 ? "unused" : `${row.entryCount}`;
      console.log(`  ${row.name.padEnd(width)}  ${count.padStart(6)}`);
    }
    return;
  }

  if (unused.length === 0) {
    console.log(`Every ${noun} is used by at least one entry.`);
    return;
  }

  console.log(
    `${unused.length} ${unused.length === 1 ? noun : plural} used by no entry:`,
  );
  for (const name of unused) console.log(`  ${name}`);

  if (!doDelete) {
    console.log("");
    console.log(`Nothing was written. Re-run with --delete to remove ${unused.length === 1 ? "it" : "them"}.`);
    return;
  }

  // Belt and braces before a destructive run: the scan said these carry no
  // entries, so this must come back empty. If it ever doesn't, something changed
  // under us between the two reads and the delete is abandoned rather than
  // detaching a name from live entries without a word.
  const stillUsed = taxonomyInUseAmong(deps.journalRepo, kind, unused);
  if (stillUsed.length > 0) {
    console.error(
      `Refusing to delete: ${stillUsed.length} of those are in use after all ` +
        `(${stillUsed.map((row) => `${row.name} — ${row.entryCount}`).join(", ")}).`,
    );
    process.exitCode = 1;
    return;
  }

  // The same single-name use-cases the per-row delete button calls, one at a
  // time, so one bad name doesn't abandon the rest — matching the web action.
  let deleted = 0;
  const failures: string[] = [];
  for (const name of unused) {
    try {
      if (kind === "category") deps.journalRepo.deleteCategory(name);
      else deps.journalRepo.deleteTag(name);
      deleted += 1;
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  console.log("");
  console.log(`Deleted ${deleted} ${deleted === 1 ? noun : plural}.`);
  if (failures.length > 0) {
    console.error(`${failures.length} could not be deleted:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

/**
 * `--merge "a,b" --into "New"` — print what the merge would do, and with
 * `--apply` perform it.
 *
 * The same `planTaxonomyMerge`/`mergeTaxonomy` pair the web dialog calls, so the
 * summary printed here is the summary it shows.
 */
function mergeSelection(
  kind: TaxonomyUsageKind,
  rawSources: string,
  target: string | undefined,
  apply: boolean,
): void {
  const noun = kind === "category" ? "category" : "tag";
  const plural = kind === "category" ? "categories" : "tags";

  if (target === undefined || target.trim() === "") {
    console.error(`--merge needs --into "<new name>" to say what to merge them into.`);
    process.exitCode = 1;
    return;
  }

  const sources = rawSources
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  if (sources.length === 0) {
    console.error(`Expected a comma-separated list of ${plural}, got "${rawSources}".`);
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = planTaxonomyMerge(deps.journalRepo, kind, { sources, target });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "That merge is not valid.");
    process.exitCode = 1;
    return;
  }

  if (plan.sources.length === 0) {
    console.log(`Nothing to merge: "${plan.target}" is the only name given.`);
    return;
  }

  console.log(
    `Merging ${plan.sources.length} ${plan.sources.length === 1 ? noun : plural} into "${plan.target}":`,
  );
  for (const source of plan.sources) console.log(`  ${source}`);
  console.log("");
  console.log(
    plan.targetExists
      ? `  "${plan.target}" already exists — it keeps its own icon and description.`
      : `  "${plan.target}" will be created.` +
          (plan.inheritedIconFrom ? ` Icon inherited from "${plan.inheritedIconFrom}".` : ""),
  );
  console.log(
    `  ${plan.entryCount} ${plan.entryCount === 1 ? "entry" : "entries"} will carry "${plan.target}".`,
  );
  if (plan.affectedFilters.length > 0) {
    console.log(`  Saved filters to update: ${plan.affectedFilters.join(", ")}`);
  }
  if (plan.affectedTemplates.length > 0) {
    console.log(`  Templates to update: ${plan.affectedTemplates.join(", ")}`);
  }

  if (!apply) {
    console.log("");
    console.log("Nothing was written. Re-run with --apply to perform this merge.");
    return;
  }

  try {
    const result = mergeTaxonomy(deps.journalRepo, kind, { sources, target });
    console.log("");
    console.log(
      `Merged ${result.mergedCount} ${result.mergedCount === 1 ? noun : plural} into "${result.target}". ` +
        `${result.entryCount} ${result.entryCount === 1 ? "entry" : "entries"} now carry it.`,
    );
    if (result.rewrittenFilters > 0 || result.rewrittenTemplates > 0) {
      console.log(
        `Updated ${result.rewrittenFilters} saved filter(s) and ${result.rewrittenTemplates} template(s).`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to merge them.");
    process.exitCode = 1;
  }
}

/**
 * The bare argument naming the list: "category" or "tag".
 *
 * Skips the token after every `--flag`, because `parseFlags` treats that as the
 * flag's value — without this, `--merge "Trips,Vacation" category` would read
 * "Trips,Vacation" as the kind and reject it. The bare tokens that remain are
 * the real positional arguments whichever order they were given in.
 */
function parseKind(args: string[]): TaxonomyUsageKind | undefined {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      index += 1; // consume the value this flag took
      continue;
    }
    positional.push(args[index]);
  }

  const bare = positional[0];
  if (bare === "category" || bare === "categories") return "category";
  if (bare === "tag" || bare === "tags") return "tag";
  console.error(
    `Expected "category" or "tag", got ${bare === undefined ? "nothing" : `"${bare}"`}.` +
      `\nUsage: journal-taxonomy <category|tag> [--unused [--delete]]` +
      ` [--merge "a,b" --into "New" [--apply]]`,
  );
  process.exitCode = 1;
  return undefined;
}
