"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { IcsImportFilter, IcsImportPresets, JournalCategory, JournalTag } from "@/lib/journal";
import { readIcsFileAction, runIcsImportAction } from "./journal-calendar-import-actions";
import type { IcsPreviewRow } from "./journal-calendar-import-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The category the import defaults to — mirrors LOG_CATEGORY_NAME in the lib. */
const DEFAULT_CATEGORY = "Log";


export interface JournalCalendarImportViewProps {
  /** The managed category list, for the preset picker's suggestions. */
  categories: JournalCategory[];
  /** The managed tag list, same purpose. */
  tags: JournalTag[];
}

/**
 * The Calendar Import section: read a Google Calendar `.ics` export, narrow it,
 * set the fields every imported entry should carry, then tick the ones to keep.
 *
 * Four cards rather than a stepper, all visible at once: the reader adjusts a
 * filter and immediately wants to see what it caught, and a wizard that hides
 * step 2 while showing step 4 makes that a back-and-forth. The cards below the
 * file picker simply have nothing in them until a file is read.
 *
 * All of the parsing, filtering, matching and writing is in `@/lib/journal`
 * (`ics-parse.ts`, `ics-import.ts`). This component holds only form state and
 * the grid's selection.
 *
 * The parsed events deliberately **never come to the client**: this holds the
 * chosen file and a flat row per event, and the server re-parses on import.
 *
 * The file travels as a `FormData` blob rather than a string argument. That is
 * not a style choice — a server action given a large string plus any other
 * argument is rejected before it runs ("Maximum array nesting exceeded"),
 * because React charges one array slot per string character against a
 * 1,000,001-slot limit. See the action's comment.
 *
 * **Narrow behaviour:** the filter and preset fields are a single column on a
 * phone (`max-lg:grid-cols-1`), and the event list is `DataGrid`'s own card
 * layout below 1024px, which keeps selection and search working there.
 */
/**
 * Turns a failed upload into something the reader can act on.
 *
 * Kept because of *which* error lands here. When a server action fails at the
 * framework level rather than inside its own try/catch, Next replaces the cause
 * with "An error occurred in the Server Components render… A digest property is
 * included", and a production build strips the message deliberately — so the
 * reader is told nothing and neither is the developer. The real reason is in the
 * server console, which the action now logs to.
 */
function describeUploadFailure(caught: unknown, file: File): string {
  const message = caught instanceof Error ? caught.message : "";
  const megabytes = (file.size / (1024 * 1024)).toFixed(1);

  if (
    message.includes("Server Components render") ||
    message.includes("digest") ||
    message.includes("Maximum array nesting") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError")
  ) {
    return (
      `Reading “${file.name}” (${megabytes} MB) failed on the server, which did not say why. ` +
      "The reason is in the server log, tagged [journal/calendar-import]."
    );
  }

  return message !== "" ? message : `Failed to read “${file.name}”.`;
}

export function JournalCalendarImportView({ categories, tags }: JournalCalendarImportViewProps) {
  const router = useRouter();

  const [fileName, setFileName] = useState("");
  /** The chosen file itself, re-sent on import as a FormData blob. */
  const [file, setFile] = useState<File | undefined>(undefined);
  const [calendarName, setCalendarName] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [parseSkipped, setParseSkipped] = useState(0);
  const [recurringCount, setRecurringCount] = useState(0);
  /** The filter the current rows were built with — re-sent on import so the
   *  server re-derives the same list the ticked indexes refer to. */
  const [appliedFilter, setAppliedFilter] = useState<IcsImportFilter>({});

  const [filter, setFilter] = useState<IcsImportFilter>({
    fromDate: "",
    toDate: "",
    summaryContains: "",
    summaryExcludes: "",
    requireSummary: true,
    includeAllDay: true,
  });

  const [presets, setPresets] = useState<IcsImportPresets>({
    categories: [DEFAULT_CATEGORY],
    tags: [],
    placeName: "",
    notePrefix: "",
    // Ticked by default: keeping your own writing is the safe behaviour, and a
    // full replace is the deliberate act. See migration 0089.
    preserveLocalEdits: true,
  });
  // Categories and tags are edited as delimited text, matching the entry form's
  // own inputs — the split happens once, on submit.
  const [categoryText, setCategoryText] = useState(DEFAULT_CATEGORY);
  const [tagText, setTagText] = useState("");

  const [rows, setRows] = useState<IcsPreviewRow[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function splitNames(value: string): string[] {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }

  /** The presets as the library wants them, with the two text fields split. */
  function currentPresets(): IcsImportPresets {
    return {
      ...presets,
      categories: splitNames(categoryText),
      tags: splitNames(tagText),
    };
  }

  /**
   * Builds the payload for both actions.
   *
   * A `FormData` blob, not string arguments — this is the whole bug this screen
   * had. A server action given a large string **plus any other argument** is
   * rejected before it runs with "Maximum array nesting exceeded": React wraps a
   * multi-argument call in an array and charges one array slot per string
   * character, against a 1,000,001-slot limit. A 2.4 MB calendar is ~2.4 million
   * characters. Sent as a blob the file is binary on the wire and never counted,
   * so there is no size ceiling. See the action's own comment for the detail.
   */
  function buildPayload(
    chosenFile: File,
    nextFilter: IcsImportFilter,
    indexes?: number[],
  ): FormData {
    const payload = new FormData();
    payload.set("file", chosenFile, chosenFile.name);
    payload.set("filter", JSON.stringify(nextFilter));
    payload.set("presets", JSON.stringify(currentPresets()));
    if (indexes) payload.set("selectedIndexes", JSON.stringify(indexes));
    return payload;
  }

  /**
   * Reads (or re-reads) the file and rebuilds the grid's rows.
   *
   * Parse, filter and plan all happen in the one action, so a file select and a
   * filter change both land here. `nextFilter` is remembered as
   * `appliedFilter`: the import re-parses server-side and must use the same
   * filter, or the ticked indexes would point into a different list.
   */
  async function readFile(chosenFile: File, nextFilter: IcsImportFilter) {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await readIcsFileAction(buildPayload(chosenFile, nextFilter));
      if (!result.ok) {
        setError(result.error ?? "Failed to read the calendar file.");
        return;
      }

      setFile(chosenFile);
      setFileName(chosenFile.name);
      setAppliedFilter(nextFilter);
      setRows(result.rows ?? []);
      setTotalCount(result.totalCount ?? 0);
      setMatchedCount(result.matchedCount ?? 0);
      setParseSkipped(result.skippedCount ?? 0);
      setCalendarName(result.calendarName ?? "");
      setRecurringCount(result.recurringCount ?? 0);

      if ((result.matchedCount ?? 0) === 0) {
        setNotice(
          (result.totalCount ?? 0) === 0
            ? "That file holds no calendar events."
            : `No events matched the filter (${result.totalCount} in the file).`,
        );
      }
    } catch (caught) {
      setError(describeUploadFailure(caught, chosenFile));
    } finally {
      setIsBusy(false);
    }
  }

  async function onFileChosen(chosen: File | undefined) {
    if (!chosen) return;
    await readFile(chosen, filter);
  }

  /** Re-applies the filter, or the presets, to the file already loaded. */
  async function applyFilter() {
    if (!file) return;
    await readFile(file, filter);
  }

  async function runImport(indexes: number[]) {
    if (indexes.length === 0 || !file) return;
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await runIcsImportAction(buildPayload(file, appliedFilter, indexes));
      if (!result.ok || !result.summary) {
        setError(result.error ?? "Failed to import the calendar events.");
        return;
      }

      const { importedCount, updatedCount, skippedCount } = result.summary;
      setNotice(
        `Imported ${importedCount} ${importedCount === 1 ? "entry" : "entries"}` +
          (updatedCount > 0 ? `, refreshed ${updatedCount}` : "") +
          (skippedCount > 0 ? `, skipped ${skippedCount}` : "") +
          ".",
      );
      // The action hands back refreshed rows, so the grid stops offering the
      // imported ones as new. Its own ticks are cleared by `clearSelection`.
      if (result.rows) setRows(result.rows);
      router.refresh();
    } catch (caught) {
      setError(describeUploadFailure(caught, file));
    } finally {
      setIsBusy(false);
    }
  }

  const columns: DataGridColumn<IcsPreviewRow>[] = [
    {
      key: "date",
      header: "When",
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.date}
          {row.time !== "" && <span className="text-muted"> {row.time}</span>}
          {row.isAllDay && <span className="text-muted"> (all day)</span>}
        </span>
      ),
      value: (row) => `${row.date} ${row.time}`.trim(),
    },
    {
      key: "summary",
      header: "Title",
      render: (row) =>
        row.title === "" ? (
          <span className="text-muted">(untitled)</span>
        ) : (
          row.title
        ),
      value: (row) => row.title,
    },
    {
      key: "location",
      header: "Place",
      render: (row) => row.place,
      value: (row) => row.place,
    },
    {
      key: "recurring",
      header: "Repeats",
      render: (row) =>
        row.isRecurring ? (
          <span title="Only this first occurrence will be imported">first only</span>
        ) : (
          ""
        ),
      value: (row) => (row.isRecurring ? "first only" : ""),
    },
    {
      key: "action",
      header: "Import as",
      render: (row) =>
        row.action === "create" ? (
          <span className="text-brass-dark">new entry</span>
        ) : row.action === "update" ? (
          <span title="Already imported — re-importing refreshes it">refresh existing</span>
        ) : (
          <span className="text-muted" title={row.blockedReason}>
            skip — {row.blockedReason}
          </span>
        ),
      value: (row) => row.action,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <CollapsibleCard
        title="1. Choose a calendar file"
        defaultOpen
        headerAction={
          <Comments
            title="About"
            label="About"
            content={
              "Export your calendar from Google Calendar (Settings → Import & export → Export), " +
              "unzip it, and pick one of the .ics files. Nothing is sent anywhere — the file is " +
              "read on your own server, and no Google account or API key is involved.\n\n" +
              "A repeating event imports as a single entry, its first occurrence only."
            }
          />
        }
      >
        <div className="flex flex-col gap-3">
          <input
            type="file"
            accept=".ics,text/calendar"
            disabled={isBusy}
            onChange={(changeEvent) => void onFileChosen(changeEvent.target.files?.[0])}
            className="text-sm text-ink"
          />
          {fileName !== "" && (
            <p className="text-xs text-muted">
              <span className="text-ink">{fileName}</span>
              {calendarName !== "" && <> — calendar “{calendarName}”</>} · {totalCount} event
              {totalCount === 1 ? "" : "s"} in the file, {matchedCount} matching the filter
              {parseSkipped > 0 && <> · {parseSkipped} unreadable and skipped</>}
              {recurringCount > 0 && (
                <> · {recurringCount} repeating (first occurrence only)</>
              )}
            </p>
          )}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="2. Narrow it down" defaultOpen>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            A calendar export often covers years. Narrow it to the events worth keeping, then
            re-apply.
          </p>

          <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
            <label className="flex flex-col gap-1 text-xs text-muted">
              From date
              <input
                type="date"
                value={filter.fromDate ?? ""}
                onChange={(changeEvent) =>
                  setFilter({ ...filter, fromDate: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              To date
              <input
                type="date"
                value={filter.toDate ?? ""}
                onChange={(changeEvent) =>
                  setFilter({ ...filter, toDate: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Title contains
              <input
                type="text"
                value={filter.summaryContains ?? ""}
                placeholder="swim"
                onChange={(changeEvent) =>
                  setFilter({ ...filter, summaryContains: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Title does not contain
              <input
                type="text"
                value={filter.summaryExcludes ?? ""}
                placeholder="declined"
                onChange={(changeEvent) =>
                  setFilter({ ...filter, summaryExcludes: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={filter.requireSummary ?? false}
                onChange={(changeEvent) =>
                  setFilter({ ...filter, requireSummary: changeEvent.target.checked })
                }
              />
              Skip events with no title
            </label>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={filter.includeAllDay ?? true}
                onChange={(changeEvent) =>
                  setFilter({ ...filter, includeAllDay: changeEvent.target.checked })
                }
              />
              Include all-day events
            </label>
          </div>

          <div>
            <Button size="sm" disabled={isBusy || !file} onClick={() => void applyFilter()}>
              Apply filter
            </Button>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="3. Fields for every imported entry" defaultOpen>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Applied to each entry this import creates. The <span className="text-ink">Log</span>{" "}
            category is how logged activities stay out of the Today in History card — leave it
            in place unless you mean these to read as written entries.
          </p>

          <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Categories (comma-separated)
              <input
                type="text"
                value={categoryText}
                list="journal-ics-categories"
                onChange={(changeEvent) => setCategoryText(changeEvent.target.value)}
                className={INPUT_CLASS}
              />
              <datalist id="journal-ics-categories">
                {categories.map((category) => (
                  <option key={category.name} value={category.name} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Tags (comma-separated)
              <input
                type="text"
                value={tagText}
                list="journal-ics-tags"
                placeholder="Skylar, swimming"
                onChange={(changeEvent) => setTagText(changeEvent.target.value)}
                className={INPUT_CLASS}
              />
              <datalist id="journal-ics-tags">
                {tags.map((tag) => (
                  <option key={tag.name} value={tag.name} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Place name (overrides the event&apos;s location)
              <input
                type="text"
                value={presets.placeName ?? ""}
                onChange={(changeEvent) =>
                  setPresets({ ...presets, placeName: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Note above the event&apos;s description
              <input
                type="text"
                value={presets.notePrefix ?? ""}
                onChange={(changeEvent) =>
                  setPresets({ ...presets, notePrefix: changeEvent.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={presets.preserveLocalEdits ?? true}
              onChange={(changeEvent) =>
                setPresets({ ...presets, preserveLocalEdits: changeEvent.target.checked })
              }
            />
            <span>
              Keep my own notes and edits when refreshing an event
              <span className="mt-0.5 block text-muted">
                For an event already imported, the calendar still updates the title, date, time
                and place — but a note you typed, your pin, your tags and any map points stay
                put. Untick to replace the whole entry from the calendar.
              </span>
            </span>
          </label>

          <div>
            <Button
              size="sm"
              disabled={isBusy || !file}
              onClick={() => void applyFilter()}
            >
              Apply these fields
            </Button>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="4. Pick what to import" defaultOpen>
        <div className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              Choose a file to see what would be imported.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                Tick what you want, then import. An event already imported is refreshed rather
                than duplicated, so running this again after changing something in your calendar
                is safe.
              </p>

              <DataGrid
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.index}
                emptyMessage="No events to import."
                exportFileName="journal-calendar-events"
                storageKey="journal-calendar-import-grid"
                enableSelection
                enableRecordView={false}
                renderSelectionActions={(selectedRows, clearSelection) => (
                  <Button
                    size="sm"
                    disabled={isBusy || selectedRows.length === 0}
                    onClick={() => {
                      // Passed as an argument rather than read from state: a
                      // setState in this same handler isn't visible until the
                      // next render, so `selected` would still hold the
                      // previous tick set.
                      const indexes = selectedRows
                        .filter((row) => row.action !== "skip")
                        .map((row) => row.index);
                      void runImport(indexes).then(clearSelection);
                    }}
                  >
                    Import checked
                  </Button>
                )}
              />
            </>
          )}
        </div>
      </CollapsibleCard>
    </div>
  );
}
