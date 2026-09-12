import { readFileSync } from "node:fs";
import {
  emptyIcsFilter,
  importIcsEvents,
  planIcsImport,
  readIcsFile,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

// Thin adapter: read an .ics file, apply the same filter and presets the web
// wizard offers, then either print the plan (--dry-run) or import.
//
// Every decision lives in @/lib/journal (ics-parse.ts, ics-import.ts), so this
// command and the Calendar Import screen cannot disagree about what a file means.
export async function importJournalIcsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;

  if (!filePath) {
    console.error(
      "Usage: import-journal-ics --file <path.ics> [--from YYYY-MM-DD] [--to YYYY-MM-DD] "
        + "[--contains <text>] [--excludes <text>] [--no-all-day] [--require-title] "
        + "[--categories <a,b>] [--tags <a,b>] [--place <name>] [--note <text>] "
        + "[--replace] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  function splitNames(value: string | undefined): string[] {
    // parseFlags gives every present flag a string ("" for a bare flag), so a
    // missing one is undefined and a valueless one is empty — both mean "none".
    return (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }

  try {
    const fileText = readFileSync(filePath, "utf8");

    const filter = {
      ...emptyIcsFilter(),
      fromDate: flags.from ?? "",
      toDate: flags.to ?? "",
      summaryContains: flags.contains ?? "",
      summaryExcludes: flags.excludes ?? "",
      requireSummary: "require-title" in flags,
      includeAllDay: !("no-all-day" in flags),
    };

    // Defaults to the Log category, matching the web wizard — an imported event
    // is a logged activity unless the caller says otherwise. `--categories ""`
    // is how you opt out.
    const presets = {
      categories: flags.categories === undefined ? ["Log"] : splitNames(flags.categories),
      tags: splitNames(flags.tags),
      placeName: flags.place ?? "",
      notePrefix: flags.note ?? "",
      // Matches the web screen's ticked-by-default checkbox: a matched event
      // keeps the reader's own fields unless --replace says otherwise. See 0089.
      preserveLocalEdits: !("replace" in flags),
    };

    const { events, totalCount, skippedCount, calendarName } = readIcsFile(fileText, filter);

    console.log(
      `${totalCount} event${totalCount === 1 ? "" : "s"} in the file` +
        (calendarName !== "" ? ` (calendar "${calendarName}")` : "") +
        `, ${events.length} matching the filter` +
        (skippedCount > 0 ? `, ${skippedCount} unreadable and skipped` : "") +
        ".",
    );

    const recurring = events.filter((event) => event.isRecurring).length;
    if (recurring > 0) {
      console.log(
        `  Note: ${recurring} repeating event${recurring === 1 ? "" : "s"} — ` +
          "the first occurrence only is imported.",
      );
    }

    if (events.length === 0) return;

    if ("dry-run" in flags) {
      const plan = planIcsImport(deps.journalRepo, events, presets);
      console.log(
        `Would create ${plan.createCount}, refresh ${plan.updateCount}, skip ${plan.skipCount}.`,
      );
      for (const row of plan.rows) {
        const when = `${row.event.date}${row.event.time !== "" ? ` ${row.event.time}` : ""}`;
        console.log(
          `  ${row.action.padEnd(6)} ${when}  ${row.event.summary || "(untitled)"}` +
            (row.blockedReason ? ` — ${row.blockedReason}` : ""),
        );
      }
      return;
    }

    const summary = importIcsEvents(deps.journalRepo, events, presets);
    console.log(
      `Imported ${summary.importedCount}, refreshed ${summary.updatedCount}, ` +
        `skipped ${summary.skippedCount}.`,
    );
    for (const result of summary.results) {
      if (result.status === "skipped") console.log(`  Event ${result.rowNumber}: ${result.reason}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to import journal .ics.");
    process.exitCode = 1;
  }
}
