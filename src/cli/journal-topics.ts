import {
  listEntries,
  listTopCategories,
  listTopTags,
  resolveJournalPreferences,
} from "@/lib/journal";
import {
  buildCooccurrence,
  buildEpisodes,
  buildTopicMap,
  matchTopic,
  suggestTopics,
  topicMapNodeKey,
} from "@/lib/journal-topics";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

const JOURNAL_MODULE_SLUG = "journal";

/** Matches the Topics picker's own limit. */
const SUGGESTION_LIMIT = 50;

/**
 * Journal topics from the terminal — the same use-cases the Topics screen drives.
 *
 *   journal-topics list                        the biggest subjects to ask about
 *   journal-topics map                         every subject and what it pairs with
 *   journal-topics show --term HSA             entries, episodes and related names
 *   journal-topics show --term HSA --entries   just the matched entries
 *   journal-topics show --term HSA --match-body
 *   journal-topics show --term HSA --gap-days 30
 *
 * The two flags override the stored journal preferences (`topic_match_body`,
 * `topic_episode_gap_days`) for one run. That is the point of having them here:
 * the web screen reads whatever is saved, while a terminal is the right place
 * to ask "what would I see if body matching were on?" without changing a
 * setting for everyone.
 *
 * This is also the proof the matching really lives in `src/lib/` — this file
 * reads flags and prints, and nothing else. Running it against a term before
 * building any view is how the retrieval was checked: if the right entries do
 * not come back here, no amount of canvas will save the screen.
 */
export async function journalTopicsCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list":
      return printSuggestions();
    case "map":
      return printMap(flags);
    case "show":
      return printTopic(flags, rest);
    default:
      console.log(
        "Usage:\n" +
          "  journal-topics list\n" +
          "  journal-topics map [--min-entries <n>] [--min-shared <n>]\n" +
          "  journal-topics show --term <text> [--entries] [--match-body] [--gap-days <n>]",
      );
  }
}

/** The stored journal preferences, or the defaults when the module is absent. */
function preferences() {
  const appModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  return resolveJournalPreferences(
    appModule ? listModuleSettingsFor(deps.moduleSettingsRepo, appModule.id) : [],
  );
}

function printSuggestions(): void {
  const rows = suggestTopics(
    listTopTags(deps.journalRepo, SUGGESTION_LIMIT),
    listTopCategories(deps.journalRepo, SUGGESTION_LIMIT),
  );

  if (rows.length === 0) {
    console.log("No tags or categories yet — nothing to ask about.");
    return;
  }

  for (const row of rows) {
    console.log(`${String(row.entryCount).padStart(5)}  ${row.kind.padEnd(8)}  ${row.name}`);
  }
}

function printTopic(flags: Record<string, string>, rawArgs: string[]): void {
  const term = (flags.term ?? "").trim();
  if (term === "") {
    console.error("journal-topics show: --term is required.");
    process.exitCode = 1;
    return;
  }

  const stored = preferences();
  // `--match-body` is a bare switch, so it is read off argv rather than from
  // the parsed flags (which would have swallowed the next token as its value).
  const matchBody = rawArgs.includes("--match-body") || stored.topicMatchBody;
  const gapDays = flags["gap-days"] ? Number(flags["gap-days"]) : stored.topicEpisodeGapDays;

  if (!Number.isInteger(gapDays) || gapDays < 1) {
    console.error(`journal-topics show: --gap-days must be a whole number of days.`);
    process.exitCode = 1;
    return;
  }

  const result = matchTopic(listEntries(deps.journalRepo), term, { matchBody });

  if (result.entries.length === 0) {
    console.log(`Nothing matches "${term}".`);
    if (!matchBody && result.bodyOnlyCount > 0) {
      console.log(
        `${result.bodyOnlyCount} more mention it in the body — re-run with --match-body.`,
      );
    }
    return;
  }

  console.log(
    `${result.entries.length} entries for "${term}"` +
      (result.matchedNames.length > 0 ? ` (matched: ${result.matchedNames.join(", ")})` : ""),
  );
  if (result.maskedCount > 0) {
    console.log(`${result.maskedCount} encrypted — matched by tag, text sealed.`);
  }
  if (!matchBody && result.bodyOnlyCount > 0) {
    console.log(`${result.bodyOnlyCount} more mention it in the body (--match-body to include).`);
  }

  if (rawArgs.includes("--entries")) {
    printEntries(result.entries);
    return;
  }

  console.log(`\nEpisodes (more than ${gapDays} days apart starts a new one):`);
  for (const episode of buildEpisodes(result.entries, gapDays)) {
    const span =
      episode.startDate === episode.endDate
        ? episode.startDate
        : `${episode.startDate} -> ${episode.endDate}`;
    console.log(`  ${span}  (${episode.entries.length})`);
    for (const item of episode.entries) {
      console.log(`    ${item.entry.date}  ${label(item)}`);
    }
  }

  const related = buildCooccurrence(result.entries, { exclude: result.matchedNames });
  if (related.length > 0) {
    console.log("\nTravels with:");
    for (const row of related) {
      const share = Math.round(row.share * 100);
      console.log(
        `  ${String(row.entryCount).padStart(4)} (${String(share).padStart(3)}%)  ` +
          `${row.kind.padEnd(8)}  ${row.name}`,
      );
    }
  }
}

function printEntries(entries: ReturnType<typeof matchTopic>["entries"]): void {
  for (const item of entries) {
    const kinds = [...new Set(item.reasons.map((reason) => reason.kind))].join(",");
    console.log(`  ${item.entry.date}  ${String(item.entry.id).padStart(5)}  [${kinds}]  ${label(item)}`);
  }
}

/** An entry's title, or an honest stand-in when it cannot be read. */
function label(item: { entry: { title: string; date: string }; isMasked: boolean }): string {
  if (item.isMasked) return "(encrypted)";
  return item.entry.title.trim() === "" ? item.entry.date : item.entry.title;
}

/**
 * The journal map: every subject, and the pairings between them.
 *
 * The terminal counterpart of what the Topics screen shows before a term is
 * picked. Printing the densest pairings is how the edges get checked without
 * drawing any of them — a map whose strongest link is two tags that only ever
 * co-occur by accident is a data problem, not a rendering one, and it shows
 * here first.
 */
function printMap(flags: Record<string, string>): void {
  const minEntryCount = flags["min-entries"] ? Number(flags["min-entries"]) : undefined;
  const minSharedEntries = flags["min-shared"] ? Number(flags["min-shared"]) : undefined;

  for (const [label, value] of [
    ["--min-entries", minEntryCount],
    ["--min-shared", minSharedEntries],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      console.error(`journal-topics map: ${label} must be a whole number of 1 or more.`);
      process.exitCode = 1;
      return;
    }
  }

  const map = buildTopicMap(listEntries(deps.journalRepo), {
    minEntryCount,
    minSharedEntries,
  });

  if (map.nodes.length === 0) {
    console.log("No subjects yet — tag or categorise a few entries first.");
    return;
  }

  const byKey = new Map(map.nodes.map((node) => [topicMapNodeKey(node), node.name]));

  console.log(`${map.nodes.length} subjects, ${map.edges.length} pairings.`);
  if (map.hiddenNodeCount > 0) {
    console.log(`${map.hiddenNodeCount} rarer subjects hidden (--min-entries to include).`);
  }

  console.log("\nSubjects:");
  for (const node of map.nodes) {
    console.log(
      `  ${String(node.entryCount).padStart(5)}  ${node.kind.padEnd(8)}  ${node.name}`,
    );
  }

  if (map.edges.length > 0) {
    console.log("\nPairings, strongest first:");
    for (const edge of map.edges) {
      console.log(
        `  ${String(edge.sharedEntries).padStart(5)}  ` +
          `${byKey.get(edge.a) ?? edge.a} + ${byKey.get(edge.b) ?? edge.b}`,
      );
    }
  }
}
