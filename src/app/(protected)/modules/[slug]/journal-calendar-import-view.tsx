"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { Progress3D } from "@/components/progress-3d";
import { excerptContent, icsReviewIndexesForDates } from "@/lib/journal";
import { formatDurationShort } from "@/lib/shared/date";
import type {
  IcsImportFilter,
  IcsImportPresets,
  IcsImportReview,
  JournalCategory,
  JournalEntry,
  JournalTag,
} from "@/lib/journal";
import {
  getIcsReviewEntryAction,
  quickUpdateIcsReviewEntryAction,
  readIcsFileAction,
  reviewIcsImportAction,
  runIcsImportAction,
} from "./journal-calendar-import-actions";
import type { IcsPreviewRow } from "./journal-calendar-import-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The category the import defaults to — mirrors LOG_CATEGORY_NAME in the lib. */
const DEFAULT_CATEGORY = "Log";

/**
 * How many reviewed dates the dialog shows at once.
 *
 * A year's calendar can raise dozens of dates that already hold an entry, each
 * needing its own decision. Rendering them all is a scrolling wall nobody reads
 * to the end of, so it is paged and committed in batches instead. Ten is about a
 * desktop screenful of the two-column cards.
 *
 * A constant rather than a module preference: a stored setting would want a
 * migration and a settings row, which is not worth it for a number that has no
 * reason to differ per install.
 */
const REVIEW_PAGE_SIZE = 10;


export interface JournalCalendarImportViewProps {
  /** The managed category list, for the preset picker's suggestions. */
  categories: JournalCategory[];
  /** The managed tag list, same purpose. */
  tags: JournalTag[];
  /**
   * The module's `reviewBeforeCalendarImport` preference. When true, importing
   * stops first and shows what the journal already holds on each date it would
   * write into, so a date can be dropped from the run.
   */
  reviewBeforeImport: boolean;
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

export function JournalCalendarImportView({
  categories,
  tags,
  reviewBeforeImport,
}: JournalCalendarImportViewProps) {
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

  /**
   * The open review, when the preference stopped an import to ask about dates
   * that already hold entries. `undefined` means no review is up.
   *
   * It carries the indexes the reader ticked, because the grid's selection is
   * cleared when the import finishes and the dialog's Import button needs the
   * original set.
   */
  const [pendingReview, setPendingReview] = useState<
    { review: IcsImportReview; indexes: number[] } | undefined
  >(undefined);
  /**
   * What the reader has decided about each reviewed date, in the open dialog.
   *
   * A date **absent from this map is undecided** — not the same as "keep it",
   * which is why this is a map rather than the list of exclusions it replaced.
   * `Commit reviewed` writes only the dates decided here, so an untouched date
   * can never be written by a batch the reader hasn't worked through yet.
   *
   * `Import all` keeps the older, looser meaning for the whole-run case: import
   * everything except the dates explicitly declined.
   */
  const [decisions, setDecisions] = useState<Record<string, "import" | "skip">>({});
  /** Which page of reviewed dates is on screen. Reset whenever the list changes. */
  const [reviewPage, setReviewPage] = useState(0);
  /** The dialog's Instructions card — controlled, so it never persists (see below). */
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  /**
   * How many events the in-flight import was handed, or `undefined` when nothing
   * is running. Drives the progress dialog.
   *
   * The bar it feeds is deliberately **indeterminate**: `runIcsImportAction` is
   * one server action that returns only when the whole import is done, so the
   * client cannot see "3 of 47" without splitting the write into chunked calls.
   * Showing a fake advancing percentage would be a lie about what is known, so
   * the count is reported and the motion is left unquantified.
   */
  const [importingCount, setImportingCount] = useState<number | undefined>(undefined);
  /** The finished import, held until the reader clicks OK. */
  const [importResult, setImportResult] = useState<
    | {
        importedCount: number;
        updatedCount: number;
        skippedCount: number;
        excludedCount: number;
        requestedCount: number;
        durationMs: number;
      }
    | undefined
  >(undefined);
  /** Which reviewed dates have their existing entries expanded. */
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  /**
   * The open quick-edit, stacked over the review dialog.
   *
   * `entry` is undefined while the full record is being read -- the review row
   * only carries an excerpt of the content, which is not enough to edit from.
   */
  const [quickEdit, setQuickEdit] = useState<
    { id: number; date: string; entry?: JournalEntry } | undefined
  >(undefined);
  const [quickEditTitle, setQuickEditTitle] = useState("");
  const [quickEditContent, setQuickEditContent] = useState("");
  /** Entry ids the reader has edited from this dialog — the "edited" badge. */
  const [editedEntryIds, setEditedEntryIds] = useState<number[]>([]);

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
    skipDates?: string[],
  ): FormData {
    const payload = new FormData();
    payload.set("file", chosenFile, chosenFile.name);
    payload.set("filter", JSON.stringify(nextFilter));
    payload.set("presets", JSON.stringify(currentPresets()));
    if (indexes) payload.set("selectedIndexes", JSON.stringify(indexes));
    if (skipDates && skipDates.length > 0) {
      payload.set("excludedDates", JSON.stringify(skipDates));
    }
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

  /**
   * Writes the ticked events, dropping any date the reader declined.
   *
   * The only place the import action is called. Both the direct path (preference
   * off) and the review dialog's confirm land here, so the two cannot disagree
   * about what gets written.
   */
  async function runImport(indexes: number[], skipDates: string[] = []): Promise<boolean> {
    if (indexes.length === 0 || !file) return false;
    setIsBusy(true);
    setError("");
    setNotice("");
    // Opens the progress dialog. Set before the await so the reader sees it for
    // the whole call rather than after it returns.
    setImportingCount(indexes.length);
    // Wall-clock, measured around the action itself. `performance.now()` rather
    // than `Date.now()`: it is monotonic, so a clock adjustment mid-import
    // cannot produce a negative or wildly wrong duration.
    const startedAt = performance.now();
    try {
      const result = await runIcsImportAction(
        buildPayload(file, appliedFilter, indexes, skipDates),
      );
      if (!result.ok || !result.summary) {
        setError(result.error ?? "Failed to import the calendar events.");
        return false;
      }

      const { importedCount, updatedCount, skippedCount } = result.summary;
      const excludedCount = result.excludedByReviewCount ?? 0;
      setImportResult({
        importedCount,
        updatedCount,
        skippedCount,
        excludedCount,
        requestedCount: indexes.length,
        durationMs: performance.now() - startedAt,
      });
      // The action hands back refreshed rows, so the grid stops offering the
      // imported ones as new. Its own ticks are cleared by `clearSelection`.
      if (result.rows) setRows(result.rows);
      router.refresh();
      return true;
    } catch (caught) {
      setError(describeUploadFailure(caught, file));
      return false;
    } finally {
      // Cleared in `finally` so a thrown import cannot leave the progress
      // dialog up with nothing behind it.
      setImportingCount(undefined);
      setIsBusy(false);
    }
  }

  /**
   * What the grid's Import button does.
   *
   * With the preference off this imports straight away, exactly as before. With
   * it on it first asks what the journal already holds on those dates, and opens
   * the review only if the answer is "something" — a calendar whose dates are all
   * new imports without a dialog, which is what keeps the preference from
   * becoming a click to dismiss.
   */
  async function startImport(indexes: number[]) {
    if (indexes.length === 0 || !file) return;

    if (!reviewBeforeImport) {
      await runImport(indexes);
      return;
    }

    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await reviewIcsImportAction(buildPayload(file, appliedFilter, indexes));
      if (!result.ok || !result.review) {
        setError(result.error ?? "Failed to check the journal for existing entries.");
        return;
      }

      if (result.review.groups.length === 0) {
        // Nothing to decide — don't make the reader confirm an empty dialog.
        await runImport(indexes);
        return;
      }

      setDecisions({});
      setReviewPage(0);
      setExpandedDates([]);
      // Cleared with the rest of the per-dialog answers: an "edited" badge from
      // an earlier run must not follow a fresh review onto unrelated rows.
      setEditedEntryIds([]);
      setPendingReview({ review: result.review, indexes });
    } catch (caught) {
      setError(describeUploadFailure(caught, file));
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Records what the reader decided about one date.
   *
   * Explicit rather than a toggle, because "undecided" is now a third state that
   * `Commit reviewed` depends on — a toggle could only ever flip between two.
   */
  function decideDate(date: string, decision: "import" | "skip") {
    setDecisions((current) => ({ ...current, [date]: decision }));
  }

  function toggleExpandedDate(date: string) {
    setExpandedDates((current) =>
      current.includes(date) ? current.filter((value) => value !== date) : [...current, date],
    );
  }

  /**
   * Opens the quick-edit over the review dialog and reads the full entry.
   *
   * The review dialog stays mounted underneath: it holds the parsed file, the
   * ticked indexes and every "don't import" answer so far, none of which would
   * survive navigating to the entry's own screen.
   */
  async function openQuickEdit(entryId: number, date: string) {
    setQuickEdit({ id: entryId, date });
    setQuickEditTitle("");
    setQuickEditContent("");
    const result = await getIcsReviewEntryAction(entryId);
    if (!result.ok || !result.entry) {
      setQuickEdit(undefined);
      setError(result.error ?? "Failed to load that entry.");
      return;
    }
    setQuickEditTitle(result.entry.title);
    setQuickEditContent(result.entry.content);
    setQuickEdit({ id: entryId, date, entry: result.entry });
  }

  /**
   * Saves the quick edit, then takes that date out of the import.
   *
   * Editing what is already there is an answer to the clash: the reader has
   * dealt with the day by hand, so importing on top of it is not what they
   * asked for. Dropping the date records the same "skip" decision the
   * "Don't import" button does, so there is one exclusion mechanism rather than
   * two -- and pressing Import on that date still puts it back, which is what
   * makes an accidental edit recoverable.
   */
  async function saveQuickEdit() {
    if (!quickEdit?.entry) return;
    const { id, date } = quickEdit;

    setIsBusy(true);
    try {
      const result = await quickUpdateIcsReviewEntryAction(id, {
        title: quickEditTitle,
        content: quickEditContent,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save your changes to that entry.");
        return;
      }

      // Patch the one row in place rather than re-running the review: a title or
      // content edit cannot move the entry off its date, so no group can change
      // shape, and re-reviewing would re-upload the whole file for nothing.
      setPendingReview((current) =>
        current
          ? {
              ...current,
              review: {
                ...current.review,
                groups: current.review.groups.map((group) =>
                  group.date === date
                    ? {
                        ...group,
                        existingEntries: group.existingEntries.map((existing) =>
                          existing.id === id
                            ? {
                                ...existing,
                                title: quickEditTitle,
                                // Re-excerpted through the library's own helper,
                                // so a shortened edit stops claiming there is
                                // more to show and the "…" means the same thing
                                // it does on a freshly built review.
                                ...excerptContent(quickEditContent),
                              }
                            : existing,
                        ),
                      }
                    : group,
                ),
              },
            }
          : current,
      );

      setEditedEntryIds((current) => (current.includes(id) ? current : [...current, id]));
      // The reader has handled this day by hand; don't write over it.
      decideDate(date, "skip");
      setQuickEdit(undefined);
      setNotice(
        `Saved your changes to that entry. ${date} is now set to be left out of the import — ` +
          "press Import on that date if you still want the calendar's events as well.",
      );
      // The Entries list and the module chrome are stale now.
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  /** The dates explicitly declined — what the import narrows itself by. */
  const excludedDates = Object.keys(decisions).filter((date) => decisions[date] === "skip");
  /** The dates explicitly kept, which is exactly what `Commit reviewed` writes. */
  const committableDates = Object.keys(decisions).filter(
    (date) => decisions[date] === "import",
  );

  // The reviewed dates, and the slice of them on screen. Derived rather than
  // held in state: `commitReviewedDates` rewrites the group list, and a second
  // copy would have to be kept in step with it.
  const reviewedGroups = pendingReview?.review.groups ?? [];
  const pageCount = Math.max(1, Math.ceil(reviewedGroups.length / REVIEW_PAGE_SIZE));
  // Clamped, not trusted: committing the last page shortens the list, and a
  // `reviewPage` left pointing past the end would render an empty dialog.
  const safePage = Math.min(reviewPage, pageCount - 1);
  const pageStart = safePage * REVIEW_PAGE_SIZE;
  const visibleGroups = reviewedGroups.slice(pageStart, pageStart + REVIEW_PAGE_SIZE);
  /** How many dates have an answer of either kind — what Commit reports. */
  const decidedCount = committableDates.length + excludedDates.length;

  /** Confirms the open review and imports everything not declined. */
  async function confirmReview() {
    if (!pendingReview) return;
    const { indexes } = pendingReview;
    const skipDates = excludedDates;
    setPendingReview(undefined);
    await runImport(indexes, skipDates);
  }

  /**
   * Writes just the dates the reader has decided, and leaves the rest up.
   *
   * The batched answer to a long review: work through a page, commit that much,
   * and the dialog stays open on what is left rather than making the reader hold
   * forty dates in their head to reach one Import button.
   *
   * Safe without re-reviewing the remainder, which is the reason only *decided*
   * dates are committed: the write touched only those dates, so no undecided
   * date's existing entries can have changed underneath the open dialog.
   */
  async function commitReviewedDates() {
    if (!pendingReview || !file) return;
    const groups = pendingReview.review.groups;
    const indexes = icsReviewIndexesForDates(groups, committableDates);
    const decided = new Set([...committableDates, ...excludedDates]);

    // Nothing kept, but dates were declined: there is still progress to record,
    // so drop them and skip the write rather than calling the importer with an
    // empty selection (which would mean "import everything matching the filter").
    // Branching on what `runImport` returns, not on the `error` state: this
    // closure captured `error` from an earlier render, so reading it here would
    // test a stale value and drop dates after a failed write.
    if (indexes.length > 0) {
      const wrote = await runImport(indexes);
      if (!wrote) return;
    }

    const remaining = groups.filter((group) => !decided.has(group.date));
    setDecisions({});
    setReviewPage(0);

    if (remaining.length === 0) {
      setPendingReview(undefined);
      return;
    }

    setPendingReview((current) =>
      current ? { ...current, review: { ...current.review, groups: remaining } } : current,
    );
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
                {reviewBeforeImport && (
                  <>
                    {" "}
                    Because{" "}
                    <span className="text-ink">
                      Review existing journal entry before import from Calendar
                    </span>{" "}
                    is on in Preferences, any date that already has an entry is shown for your
                    decision before anything is written.
                  </>
                )}
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
                      void startImport(indexes).then(clearSelection);
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

      {/* Hidden while a write is in flight so the progress dialog isn't a third
          stacked overlay: `Commit reviewed` deliberately keeps the review open
          across the import, unlike `Import all` which closes it first. The state
          is untouched, so the remaining dates come straight back afterwards. */}
      {pendingReview && importingCount === undefined && (
        <Modal
          title="Existing entries on these dates"
          description={reviewDescription(
            pendingReview.review,
            excludedDates.length,
            committableDates.length,
          )}
          size="lg"
          isBusy={isBusy}
          onClose={() => setPendingReview(undefined)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setPendingReview(undefined)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              {/* Writes only what has been decided, then leaves the dialog open
                  on the rest — the batched path. Disabled until something is
                  decided, so it can never mean "import everything". */}
              <Button
                variant="secondary"
                onClick={() => void commitReviewedDates()}
                disabled={isBusy || decidedCount === 0}
                title={
                  decidedCount === 0
                    ? "Decide a date first — press Import or Don't import on one"
                    : `Write the ${committableDates.length} date${
                        committableDates.length === 1 ? "" : "s"
                      } you kept and clear the ${decidedCount} you've reviewed`
                }
              >
                {isBusy ? "Committing…" : `Commit reviewed (${decidedCount})`}
              </Button>
              <Button onClick={() => void confirmReview()} disabled={isBusy}>
                {isBusy ? "Importing…" : "Import all"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {/* Controlled, so it never writes to the persisted card map.
                `CollapsibleCard` remembers an *uncontrolled* card by its mount
                order within the route, and this one only mounts while the dialog
                is open — it would claim whatever ordinal happened to be next and
                could read a card on the page behind it. */}
            <CollapsibleCard
              title="How this screen works"
              open={isInstructionsOpen}
              onOpenChange={setIsInstructionsOpen}
            >
              <div className="flex flex-col gap-2 text-xs text-muted">
                <p>
                  Each card below is <strong className="text-ink">one date</strong> where the
                  calendar would write on a day your journal already has something. The left
                  column is what the <strong className="text-ink">calendar file</strong> holds;
                  the right is what is <strong className="text-ink">already in the journal</strong>.
                </p>
                <p>
                  Decide each date with <strong className="text-ink">Import</strong> or{" "}
                  <strong className="text-ink">Don&apos;t import</strong>. A date you
                  haven&apos;t pressed either on counts as{" "}
                  <strong className="text-ink">not yet reviewed</strong> and will not be written
                  by Commit.
                </p>
                <p>
                  <strong className="text-ink">Commit reviewed</strong> writes just the dates you
                  kept, then clears every date you&apos;ve decided and leaves the rest here — so
                  a long calendar can be worked through {REVIEW_PAGE_SIZE} dates at a time instead
                  of in one sitting. Nothing outside the dates you decided is touched.
                </p>
                <p>
                  <strong className="text-ink">Import all</strong> ignores the paging and imports
                  every date except the ones you declined.{" "}
                  <strong className="text-ink">Cancel</strong> writes nothing at all.
                </p>
                <p>
                  <strong className="text-ink">Edit</strong> on a journal entry fixes its title
                  and content without leaving this screen. Saving an edit also sets that date to{" "}
                  <strong className="text-ink">Don&apos;t import</strong>, on the assumption you
                  have handled the day by hand — press Import on it if you want the
                  calendar&apos;s events as well.
                </p>
              </div>
            </CollapsibleCard>

            {/* Only shown when there is more than one page: a short review
                should not have to read past paging chrome it doesn't need. */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 max-lg:flex-col max-lg:items-stretch">
                <p className="text-xs text-muted">
                  Showing {pageStart + 1}–{pageStart + visibleGroups.length} of{" "}
                  {reviewedGroups.length} dates · page {safePage + 1} of {pageCount}
                  {decidedCount > 0 && (
                    <span className="text-brass-dark"> · {decidedCount} decided</span>
                  )}
                </p>
                <div className="flex shrink-0 gap-2 max-lg:w-full">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isBusy || safePage === 0}
                    onClick={() => setReviewPage(Math.max(0, safePage - 1))}
                  >
                    Back
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isBusy || safePage >= pageCount - 1}
                    onClick={() => setReviewPage(Math.min(pageCount - 1, safePage + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}

            {visibleGroups.map((group) => {
              const decision = decisions[group.date];
              const isExcluded = decision === "skip";
              const isExpanded = expandedDates.includes(group.date);
              // One toggle for the whole date: the two columns sit next to each
              // other, so expanding only one would leave them visibly unequal.
              const hasTruncated =
                group.incomingEvents.some((incoming) => incoming.isContentTruncated) ||
                group.existingEntries.some((existing) => existing.isContentTruncated);
              return (
                <div
                  key={group.date}
                  className={`rounded-md border p-3 ${
                    isExcluded
                      ? "border-line bg-paper/40 opacity-60"
                      : decision === "import"
                        ? "border-brass bg-paper"
                        : "border-line bg-paper"
                  }`}
                >
                  {/* Stacks below 1024px: the date and the two buttons don't fit
                      on one line on a phone. */}
                  <div className="flex items-start justify-between gap-3 max-lg:flex-col">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink">
                        {group.date}
                        {/* Undecided is a real state now — Commit skips it — so
                            it says so rather than looking the same as kept. */}
                        {decision === undefined ? (
                          <span className="text-xs font-normal text-muted">
                            not yet reviewed
                          </span>
                        ) : (
                          <span
                            className={`rounded-sm px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
                              decision === "import"
                                ? "bg-brass-soft text-brass-dark"
                                : "bg-line text-muted"
                            }`}
                          >
                            {decision === "import" ? "importing" : "left out"}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {group.existingEntries.length} existing{" "}
                        {group.existingEntries.length === 1 ? "entry" : "entries"} ·{" "}
                        {group.selectedEventCount}{" "}
                        {group.selectedEventCount === 1 ? "event" : "events"} to import
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2 max-lg:w-full">
                      {/* Both stay pressable whatever the current answer is: a
                          decision is changeable until it is committed, and the
                          active one is shown by its variant. */}
                      <Button
                        size="sm"
                        variant={decision === "import" ? "primary" : "secondary"}
                        disabled={isBusy}
                        onClick={() => decideDate(group.date, "import")}
                      >
                        Import
                      </Button>
                      <Button
                        size="sm"
                        variant={isExcluded ? "primary" : "secondary"}
                        disabled={isBusy}
                        onClick={() => decideDate(group.date, "skip")}
                      >
                        Don&apos;t import
                      </Button>
                    </div>
                  </div>

                  {/* The two sides, side by side on a wide screen and stacked
                      below 1024px. Each column carries three cues for which
                      side it is -- a heading, a tinted left rule, and a chip on
                      every row -- because once they stack, position says
                      nothing, and a single row read on its own still has to be
                      unambiguous. */}
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 max-lg:grid-cols-1">
                    <section className="rounded-md border-l-2 border-brass bg-brass-soft/30 py-2 pl-3 pr-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-brass-dark">
                        From ICS · importing{" "}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          ({group.incomingEvents.length})
                        </span>
                      </h4>
                      <ul className="mt-2 flex flex-col gap-2">
                        {group.incomingEvents.map((incoming) => (
                          <li key={incoming.eventIndex} className="text-xs">
                            <p className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                              <span className="rounded-sm bg-brass-soft px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-brass-dark">
                                ICS
                              </span>
                              {incoming.isAllDay ? (
                                <span className="text-muted">all day</span>
                              ) : (
                                incoming.time !== "" && (
                                  <span className="text-muted">{incoming.time}</span>
                                )
                              )}
                              {incoming.title === "" ? (
                                <span className="text-muted">(untitled)</span>
                              ) : (
                                <span>{incoming.title}</span>
                              )}
                              <span
                                className="text-muted"
                                title={
                                  incoming.willRefresh
                                    ? "This event was imported before — importing refreshes that entry in place"
                                    : "No entry carries this event's UID yet — importing adds a new one"
                                }
                              >
                                · {incoming.willRefresh ? "refreshes existing" : "new entry"}
                              </span>
                            </p>
                            {incoming.location !== "" && (
                              <p className="mt-0.5 text-muted">{incoming.location}</p>
                            )}
                            {incoming.content !== "" && (
                              <p className="mt-0.5 whitespace-pre-wrap text-muted">
                                {isExpanded || !incoming.isContentTruncated
                                  ? incoming.content
                                  : `${incoming.content}…`}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>

                    <section className="rounded-md border-l-2 border-line bg-paper-raised py-2 pl-3 pr-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Existing entry · already here{" "}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          ({group.existingEntries.length})
                        </span>
                      </h4>
                      <ul className="mt-2 flex flex-col gap-2">
                        {group.existingEntries.map((existing) => (
                          <li key={existing.id} className="text-xs">
                            <p className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                              <span className="rounded-sm bg-line px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">
                                Journal
                              </span>
                              {existing.time !== "" && (
                                <span className="text-muted">{existing.time}</span>
                              )}
                              {existing.title === "" ? (
                                <span className="text-muted">(untitled)</span>
                              ) : (
                                <span>{existing.title}</span>
                              )}
                              {existing.isFromCalendar && (
                                <span
                                  className="text-muted"
                                  title="This entry was itself imported from a calendar"
                                >
                                  · from calendar
                                </span>
                              )}
                              {editedEntryIds.includes(existing.id) && (
                                <span
                                  className="rounded-sm bg-brass-soft px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-brass-dark"
                                  title="You edited this entry from this dialog"
                                >
                                  edited
                                </span>
                              )}
                              {/* An inline row action, so a text link rather
                                  than a button — design.md → the button rules. */}
                              <button
                                type="button"
                                disabled={isBusy || existing.isLocked}
                                onClick={() => void openQuickEdit(existing.id, group.date)}
                                title={
                                  existing.isLocked
                                    ? "This entry is locked — unlock it before editing"
                                    : "Edit this entry's title and content without leaving the import"
                                }
                                className="text-brass-dark underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                              >
                                Edit
                              </button>
                            </p>
                            {existing.content !== "" && (
                              <p className="mt-0.5 whitespace-pre-wrap text-muted">
                                {isExpanded || !existing.isContentTruncated
                                  ? existing.content
                                  : `${existing.content}…`}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  {hasTruncated && (
                    <button
                      type="button"
                      onClick={() => toggleExpandedDate(group.date)}
                      className="mt-1 text-xs text-brass-dark underline-offset-2 hover:underline"
                    >
                      {isExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Stacked over the review dialog, which stays mounted underneath: it
          holds the parsed file, the ticked indexes and every "don't import"
          answer, none of which would survive going to the entry's own screen.
          Both modals are `z-50`, so this one paints on top by being rendered
          after it. */}
      {quickEdit && (
        <Modal
          title="Edit this entry"
          description={
            quickEdit.entry
              ? `Changing the title and content of the entry on ${quickEdit.date}. Saving also ` +
                `leaves ${quickEdit.date} out of this import — press Import on that date if you ` +
                "want the calendar's events as well."
              : "Reading the entry…"
          }
          size="md"
          isBusy={isBusy}
          onClose={() => setQuickEdit(undefined)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setQuickEdit(undefined)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void saveQuickEdit()}
                disabled={isBusy || !quickEdit.entry}
              >
                {isBusy ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          {quickEdit.entry ? (
            // One column at every width: two short fields have nothing to gain
            // from a second, and this reads the same on a phone as on a desktop.
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">Title</span>
                <input
                  type="text"
                  value={quickEditTitle}
                  onChange={(changed) => setQuickEditTitle(changed.target.value)}
                  disabled={isBusy}
                  className={`w-full ${INPUT_CLASS}`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">Content</span>
                <textarea
                  value={quickEditContent}
                  onChange={(changed) => setQuickEditContent(changed.target.value)}
                  disabled={isBusy}
                  rows={10}
                  className={`w-full ${INPUT_CLASS}`}
                />
              </label>
              <p className="text-xs text-muted">
                Only the title and content change here. This entry&apos;s date, time, place,
                categories, tags and pin are left exactly as they are — edit those on the
                entry&apos;s own screen.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">Reading the entry…</p>
          )}
        </Modal>
      )}

      {/* While the write is in flight. No ✕ and no footer: there is nothing to
          decide, and `isBusy` already suppresses Escape and the overlay click so
          a half-finished import can't be orphaned by a stray keypress. */}
      {importingCount !== undefined && (
        <Modal
          title="Importing"
          size="sm"
          isBusy
          onClose={() => {
            /* Not dismissable while writing — the import owns this dialog. */
          }}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Importing {importingCount} {importingCount === 1 ? "entry" : "entries"}…
            </p>
            {/* Indeterminate on purpose: one server action means the client
                cannot see how far through it is. A percentage here would be
                invented. */}
            <Progress3D value={undefined} ariaLabel="Calendar import progress" />
            <p className="text-xs text-muted">
              This can take a moment on a large calendar. Please don&apos;t close this
              tab — the import finishes on the server either way, but you&apos;d lose the
              summary.
            </p>
          </div>
        </Modal>
      )}

      {/* The ending the reader has to acknowledge, rather than a notice that
          scrolls away unread. */}
      {importResult && (
        <Modal
          title="Import finished"
          size="sm"
          onClose={() => setImportResult(undefined)}
          footer={
            <Button onClick={() => setImportResult(undefined)}>OK</Button>
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-ink">
              {importResult.importedCount}{" "}
              {importResult.importedCount === 1 ? "entry" : "entries"} imported
              {importResult.updatedCount > 0 && (
                <> · {importResult.updatedCount} refreshed</>
              )}
              .
            </p>
            <dl className="flex flex-col gap-1 text-xs text-muted">
              <div className="flex justify-between gap-3">
                <dt>Events sent to the importer</dt>
                <dd className="text-ink">{importResult.requestedCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>New entries</dt>
                <dd className="text-ink">{importResult.importedCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Existing entries refreshed</dt>
                <dd className="text-ink">{importResult.updatedCount}</dd>
              </div>
              {importResult.skippedCount > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>Skipped by the importer</dt>
                  <dd className="text-ink">{importResult.skippedCount}</dd>
                </div>
              )}
              {importResult.excludedCount > 0 && (
                <div className="flex justify-between gap-3">
                  {/* Counted apart from `skipped`: the reader chose these, so it
                      is not the importer declining to act on something. */}
                  <dt>Left out on dates you kept</dt>
                  <dd className="text-ink">{importResult.excludedCount}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-line pt-1">
                <dt>Total duration</dt>
                <dd className="text-ink">{formatDurationShort(importResult.durationMs)}</dd>
              </div>
            </dl>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The dialog's sub-heading: what is being asked, and what has been answered. */
function reviewDescription(
  review: IcsImportReview,
  excludedCount: number,
  keptCount: number,
): string {
  const dateCount = review.groups.length;
  const parts = [
    `${dateCount} of the ${review.totalDateCount} ${
      review.totalDateCount === 1 ? "date" : "dates"
    } you're importing into already ${dateCount === 1 ? "has an entry" : "have entries"}.`,
  ];

  if (review.unaffectedEventCount > 0) {
    parts.push(
      `${review.unaffectedEventCount} ${
        review.unaffectedEventCount === 1 ? "event lands" : "events land"
      } on dates with nothing on them yet and will import either way.`,
    );
  }

  if (keptCount > 0) {
    parts.push(`${keptCount} ${keptCount === 1 ? "date is" : "dates are"} set to import.`);
  }

  if (excludedCount > 0) {
    parts.push(
      `${excludedCount} ${excludedCount === 1 ? "date is" : "dates are"} set to be left out.`,
    );
  }

  // Said explicitly because it is what Commit will *not* write — the reader
  // should not have to infer it from the two counts above.
  const undecided = dateCount - keptCount - excludedCount;
  if (undecided > 0 && keptCount + excludedCount > 0) {
    parts.push(
      `${undecided} ${undecided === 1 ? "is" : "are"} still to review.`,
    );
  }

  return parts.join(" ");
}
