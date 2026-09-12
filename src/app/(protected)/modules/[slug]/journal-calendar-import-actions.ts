"use server";

import { revalidatePath } from "next/cache";
import type { ImportSummary } from "@/lib/csv-import";
import {
  icsImportFilterSchema,
  icsImportPresetsSchema,
  icsSelectionSchema,
  importIcsEvents,
  planIcsImport,
  readIcsFile,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const JOURNAL_MODULE_PATH = "/modules/journal";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Turns a thrown error into a result the screen can show, and logs the cause.
 *
 * The log is the point. A server action that fails outside its own catch gets
 * replaced by Next with *"An error occurred in the Server Components render…
 * A digest property is included"*, and a production build strips the message
 * deliberately — so neither the reader nor the developer learns anything. That
 * opacity cost several wrong diagnoses of this very screen, so the real message
 * now goes to the server console where it can be read.
 */
function toErrorResult(error: unknown, fallback: string): ActionResult {
  console.error("[journal/calendar-import]", fallback, error);

  if (!(error instanceof Error)) return { ok: false, error: fallback };

  // A zod failure names a field, which is noise to a reader who never saw a
  // form — they picked a file. The prose fallback is more use to them.
  if (error.name === "ZodError") return { ok: false, error: fallback };

  return { ok: false, error: `${fallback} (${error.message})` };
}

/** Reads one JSON-encoded `FormData` field, treating absent and blank as `{}`. */
function readJsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  return typeof raw === "string" && raw !== "" ? JSON.parse(raw) : {};
}

/**
 * One event as the selection grid needs it: what it says, and what the import
 * would do with it.
 *
 * Deliberately **not** the full `IcsEvent`. An earlier version returned the
 * parsed events and had the client hand all of them back on every call, which
 * is a large payload over the wire for no benefit. The events now stay on the
 * server; only these flat rows travel down, and only the file and the ticked
 * indexes travel up.
 *
 * Descriptions are excluded for the same reason: the grid never shows them, and
 * they are the bulk of the bytes.
 */
export interface IcsPreviewRow {
  /** Index into the *filtered* event list — the selection key. */
  index: number;
  date: string;
  time: string;
  isAllDay: boolean;
  title: string;
  place: string;
  isRecurring: boolean;
  action: "create" | "update" | "skip";
  blockedReason?: string;
}

export interface ReadIcsResult extends ActionResult {
  /** Events matching the filter, flattened for the grid. */
  rows?: IcsPreviewRow[];
  /** Events in the file before the filter was applied. */
  totalCount?: number;
  /** Events matching the filter. */
  matchedCount?: number;
  /** VEVENTs that carried no usable start date and were dropped. */
  skippedCount?: number;
  /** X-WR-CALNAME from the file, for display. */
  calendarName?: string;
  /** How many of the matched events repeat, so the screen can say so. */
  recurringCount?: number;
  createCount?: number;
  updateCount?: number;
}

/** Builds the grid's rows from a plan — the one shape both actions return. */
function toPreviewRows(plan: ReturnType<typeof planIcsImport>): IcsPreviewRow[] {
  return plan.rows.map((row) => ({
    index: row.eventIndex,
    date: row.event.date,
    time: row.event.time,
    isAllDay: row.event.isAllDay,
    title: row.event.summary,
    place: row.event.location,
    isRecurring: row.event.isRecurring,
    action: row.action,
    blockedReason: row.blockedReason,
  }));
}

/**
 * Parses an uploaded .ics, applies the filter, and returns one flat row per
 * matching event together with what importing it would do.
 *
 * Parse and plan happen in the same call because the plan is what makes the
 * grid useful ("new" vs "already imported"), and doing it here avoids sending
 * the events out and back just to ask.
 *
 * ## Why `FormData`, and not `(fileText, filter, presets)`
 *
 * Because a big string plus *any* further argument is rejected before this
 * function runs, with *"Maximum array nesting exceeded"*. That message names
 * nesting, but the mechanism is neither nesting nor total size:
 *
 * - React wraps a multi-argument call in an array, and its decoder charges that
 *   array **one slot per character** of every string inside it. The limit is
 *   1,000,001 slots, so any file over ~1 MB of text exceeds it.
 * - A **single** argument is not wrapped in an array, so nothing is counted.
 *   The same 2.4 MB file passes alone and fails with a `{}` beside it — the
 *   second argument's type is irrelevant, and a trailing `undefined` suffices.
 *
 * `FormData` carrying a `Blob` sidesteps the counter entirely: the file is
 * binary on the wire, not a counted string, so there is no text ceiling. The
 * filter and presets ride along as JSON fields.
 *
 * The use-cases underneath (`readIcsFile`, `planIcsImport`) still take plain
 * data, so the CLI calls them directly and unchanged (ARCHITECTURE.md → every
 * use-case callable from both). Only this boundary knows about `FormData`.
 */
export async function readIcsFileAction(formData: FormData): Promise<ReadIcsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return { ok: false, error: "No calendar file was received. Choose the file again." };
    }

    const parsedFilter = icsImportFilterSchema.parse(readJsonField(formData, "filter"));
    const parsedPresets = icsImportPresetsSchema.parse(readJsonField(formData, "presets"));
    const result = readIcsFile(await file.text(), parsedFilter);

    // No selection: describe every matching event, so the grid can show what
    // each *would* do before anything is ticked.
    const plan = planIcsImport(deps.journalRepo, result.events, parsedPresets);

    return {
      ok: true,
      rows: toPreviewRows(plan),
      totalCount: result.totalCount,
      matchedCount: result.events.length,
      skippedCount: result.skippedCount,
      calendarName: result.calendarName,
      recurringCount: result.events.filter((event) => event.isRecurring).length,
      createCount: plan.createCount,
      updateCount: plan.updateCount,
    };
  } catch (error) {
    return toErrorResult(error, "Failed to read the calendar file.");
  }
}

export interface IcsImportResult extends ActionResult {
  summary?: ImportSummary;
  /** The refreshed rows, so the grid can show what is now already imported. */
  rows?: IcsPreviewRow[];
}

/**
 * Imports the ticked events as journal entries.
 *
 * Takes the **file** and re-parses it rather than receiving the events back:
 * the indexes the reader ticked are positions in the filtered list, and parsing
 * is deterministic, so re-deriving that list here yields the same order. The
 * same filter must therefore be sent as was used to build the preview — the
 * view holds both and sends them together.
 *
 * `FormData` again, for the reason `readIcsFileAction` explains at length: the
 * file and anything alongside it cannot both travel as plain arguments.
 */
export async function runIcsImportAction(formData: FormData): Promise<IcsImportResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return { ok: false, error: "No calendar file was received. Choose the file again." };
    }

    const parsedFilter = icsImportFilterSchema.parse(readJsonField(formData, "filter"));
    const parsedPresets = icsImportPresetsSchema.parse(readJsonField(formData, "presets"));

    const rawSelection = formData.get("selectedIndexes");
    const selection =
      typeof rawSelection === "string" && rawSelection !== ""
        ? icsSelectionSchema.parse(JSON.parse(rawSelection))
        : undefined;

    const { events } = readIcsFile(await file.text(), parsedFilter);
    const summary = importIcsEvents(deps.journalRepo, events, parsedPresets, selection);
    revalidatePath(JOURNAL_MODULE_PATH);

    // Re-plan against the just-written entries so the grid stops offering the
    // imported rows as new.
    const plan = planIcsImport(deps.journalRepo, events, parsedPresets);

    return { ok: true, summary, rows: toPreviewRows(plan) };
  } catch (error) {
    return toErrorResult(error, "Failed to import the calendar events.");
  }
}
