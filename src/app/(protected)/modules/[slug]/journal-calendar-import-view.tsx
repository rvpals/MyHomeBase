"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { Progress3D } from "@/components/progress-3d";
import { TokenPicker } from "@/components/token-picker";
import {
  ENCRYPTED_TITLE_PLACEHOLDER,
  excerptContent,
  icsReviewIndexesForDates,
} from "@/lib/journal";
import { formatDurationShort } from "@/lib/shared/date";
import type {
  IcsDuplicateAction,
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

/**
 * The choices card 4 offers for an already-imported event.
 *
 * A table rather than three hand-written blocks so the labels and their
 * explanations stay together, and the radio list is one map. The values are the
 * library's `IcsDuplicateAction`, so a typo here is a typecheck failure rather
 * than a silently ignored setting.
 */
const DUPLICATE_ACTION_OPTIONS: {
  value: IcsDuplicateAction;
  label: string;
  description: string;
}[] = [
  {
    value: "refresh",
    label: "Refresh the existing entry",
    description:
      "The entry follows the calendar: its title, date, time and place are updated in place. " +
      "This is the default, and keeps one entry per event however many times you re-import.",
  },
  {
    value: "skip",
    label: "Leave the existing entry alone",
    description:
      "Already-imported events are skipped entirely, so only events new to this journal are " +
      "written. Use this to pick up additions to a calendar without disturbing what you have.",
  },
  {
    value: "duplicate",
    label: "Import it again as a new entry",
    description:
      "Writes a second entry rather than touching the first. Repeating this keeps adding " +
      "entries — two runs give you two copies, three give you three — so reach for it only " +
      "when you want a fresh copy of something you have changed beyond use.",
  },
];


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
  /**
   * The real `<input type="file">`, kept hidden and clicked by the button.
   *
   * A file dialog can only be opened by a genuine user gesture on an input, so
   * the button forwards its click here rather than the input being restyled —
   * `::file-selector-button` can't be made to match `Button`, and a `<label>`
   * dressed as a button loses the disabled state while a parse is running.
   */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Whether a drag is currently over the drop zone — purely the highlight. */
  const [isDraggingOver, setIsDraggingOver] = useState(false);
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
    // The importer's long-standing behaviour, stated rather than left to the
    // schema's default so card 4 opens with a radio visibly selected.
    duplicateAction: "refresh",
  });

  const [rows, setRows] = useState<IcsPreviewRow[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  /**
   * Whether the file is being parsed right now — drives the "please wait"
   * dialog over step 4.
   *
   * A flag of its own rather than reusing `isBusy`, which is also raised by the
   * import write, the review check and the quick-edit save: keyed off that, the
   * dialog would claim it was parsing a calendar while saving one entry's title.
   * Set only inside `readFile`, which is the one path that actually parses.
   */
  const [isParsing, setIsParsing] = useState(false);
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

  /**
   * The presets as the library wants them. `presets` already holds the chosen
   * names as arrays — the TokenPickers in card 3 write them straight in — so
   * there is nothing left to split here.
   */
  function currentPresets(): IcsImportPresets {
    return presets;
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
    // Raised before the await, so the dialog covers the whole call rather than
    // flashing up as it returns.
    setIsParsing(true);
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
      // Cleared in `finally` for the reason the import's is: a file that throws
      // mid-parse must not leave the dialog up with nothing running behind it.
      setIsParsing(false);
      setIsBusy(false);
    }
  }

  async function onFileChosen(chosen: File | undefined) {
    if (!chosen) return;
    await readFile(chosen, filter);
  }

  /**
   * Accepts a dropped file, refusing anything that isn't a calendar.
   *
   * The extension is checked rather than the MIME type: a `.ics` dropped from
   * Windows Explorer routinely arrives as `""` or `application/octet-stream`
   * depending on what is registered to open it, so trusting `file.type` would
   * reject perfectly good files. The parser is the real validator — this only
   * catches the obvious mistake of dropping a photo, and says so rather than
   * letting the reader wait for a parse that was never going to work.
   */
  async function onFileDropped(dropped: File | undefined) {
    if (!dropped) return;

    if (!dropped.name.toLowerCase().endsWith(".ics")) {
      setError(
        `“${dropped.name}” isn’t a calendar file. Drop the .ics file from your ` +
          "Google Calendar export (unzip it first).",
      );
      return;
    }

    await readFile(dropped, filter);
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
    // eslint-disable-next-line react-hooks/purity -- reads the clock/locale, which is browser-only and intentionally not render-pure.
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
        // eslint-disable-next-line react-hooks/purity -- reads the clock/locale, which is browser-only and intentionally not render-pure.
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

  /**
   * Records the same decision for every date on the current page.
   *
   * "The batch on screen" is exactly `visibleGroups`, so this deliberately does
   * *not* touch a date on another page — a reader who marks a page as Import has
   * said something about the ten dates in front of them, not about forty they
   * haven't read. Working through the review a page at a time is the whole point
   * of the paging, and `Commit reviewed` already writes only decided dates.
   *
   * Overwrites an existing answer on those dates rather than filling in only the
   * blanks: the buttons read as "mark this batch", and a reader correcting a
   * mis-set page expects the second press to win.
   */
  function decideVisibleDates(decision: "import" | "skip") {
    setDecisions((current) => {
      const next = { ...current };
      for (const group of visibleGroups) next[group.date] = decision;
      return next;
    });
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
          {/* The input itself is never seen: it carries the file dialog, and the
              button below opens it. `hidden` rather than `sr-only` — it is not
              a control a screen reader should land on separately, since the
              button is the labelled affordance for the same action.

              Reset to "" on every change so choosing the *same* file twice in a
              row still fires `onChange`; without it the second pick is silently
              ignored, which reads as the screen having frozen. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={(changeEvent) => {
              const chosen = changeEvent.target.files?.[0];
              changeEvent.target.value = "";
              void onFileChosen(chosen);
            }}
          />

          {/* The drop zone doubles as the button's surround: one target, so
              there is no gap between "click here" and "drop here" that does
              nothing. A plain div rather than a label — the button inside it
              would otherwise open the dialog twice per click, once itself and
              once through the label. */}
          <div
            onDragOver={(dragEvent) => {
              // Both required: without the preventDefault the browser navigates
              // to the dropped file instead of letting the handler run.
              dragEvent.preventDefault();
              if (!isBusy) setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(dropEvent) => {
              dropEvent.preventDefault();
              setIsDraggingOver(false);
              if (isBusy) return;
              void onFileDropped(dropEvent.dataTransfer.files?.[0]);
            }}
            className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
              isDraggingOver ? "border-brass bg-brass-soft/40" : "border-line bg-paper"
            } ${isBusy ? "opacity-60" : ""}`}
          >
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
            <p className="text-xs text-muted">
              or drag a <span className="text-ink">.ics</span> file here
            </p>
          </div>

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
            {/* The same chip pickers the New Entry form uses, so a name is
                chosen from the managed list rather than retyped — and a
                comma in a category name can no longer split it in two. */}
            <TokenPicker
              label="Categories"
              value={presets.categories}
              onChange={(names) => setPresets({ ...presets, categories: names })}
              options={categories.map((category) => category.name)}
              allowCreate
              createPlaceholder="Filter or add a category…"
            />
            <TokenPicker
              label="Tags"
              value={presets.tags}
              onChange={(names) => setPresets({ ...presets, tags: names })}
              options={tags.map((tag) => tag.name)}
              allowCreate
              createPlaceholder="Filter or add a tag…"
            />
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

      <CollapsibleCard title="4. Default options for import" defaultOpen>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            What to do with an event this journal has{" "}
            <span className="text-ink">already imported</span> — matched by the event&apos;s
            calendar ID, so a renamed or moved event is still recognised as the same one. An
            event that has never been imported is always created, whichever of these is chosen.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Action for already-imported events</legend>
            {DUPLICATE_ACTION_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-xs text-ink">
                <input
                  type="radio"
                  name="journal-ics-duplicate-action"
                  className="mt-0.5"
                  value={option.value}
                  checked={(presets.duplicateAction ?? "refresh") === option.value}
                  onChange={() =>
                    setPresets({ ...presets, duplicateAction: option.value })
                  }
                />
                <span>
                  {option.label}
                  <span className="mt-0.5 block text-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {/* Only "refresh" writes to an existing entry, so the note about
              keeping your own edits is only true under that option. Said here
              rather than silently, because the checkbox lives in card 3 and a
              reader who set "skip" could otherwise wonder why it stopped
              mattering. */}
          {(presets.duplicateAction ?? "refresh") !== "refresh" && (
            <p className="text-xs text-muted">
              <span className="text-ink">Keep my own notes and edits</span> in card 3 only
              applies when refreshing, so it has no effect on this setting.
            </p>
          )}

          <div>
            <Button size="sm" disabled={isBusy || !file} onClick={() => void applyFilter()}>
              Apply these options
            </Button>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="5. Pick which entries to import" defaultOpen>
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
                  <strong className="text-ink">Mark batch as Import</strong> and{" "}
                  <strong className="text-ink">Mark batch Don&apos;t import</strong> set every
                  date <em>on this page</em> at once — dates on other pages are left alone. Either
                  one overwrites answers already given on this page, and a single date can still
                  be changed afterwards with its own two buttons.
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
            {/* The bar renders whatever the page count is, because the two bulk
                buttons are useful on a single-page review too — it was the
                paging *chrome* that a short review didn't need, not a way to
                clear the list in one press. Back and Next stay gated on there
                being somewhere to go.

                Wraps below 1024px: four small buttons and the count don't fit on
                one phone line, so the row becomes a column and each group goes
                full width. */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 max-lg:flex-col max-lg:items-stretch">
              <p className="text-xs text-muted">
                Showing {pageStart + 1}–{pageStart + visibleGroups.length} of{" "}
                {reviewedGroups.length} dates
                {pageCount > 1 && <> · page {safePage + 1} of {pageCount}</>}
                {decidedCount > 0 && (
                  <span className="text-brass-dark"> · {decidedCount} decided</span>
                )}
              </p>
              <div className="flex shrink-0 flex-wrap gap-2 max-lg:w-full">
                {/* Act on the dates on screen only — see `decideVisibleDates`.
                    Labelled "this page" rather than "batch" when there is more
                    than one, so it can't be read as "all 40 dates". */}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy || visibleGroups.length === 0}
                  onClick={() => decideVisibleDates("import")}
                  title={`Mark all ${visibleGroups.length} date${
                    visibleGroups.length === 1 ? "" : "s"
                  } on this page as Import`}
                >
                  Mark batch as Import
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy || visibleGroups.length === 0}
                  onClick={() => decideVisibleDates("skip")}
                  title={`Mark all ${visibleGroups.length} date${
                    visibleGroups.length === 1 ? "" : "s"
                  } on this page as Don't import`}
                >
                  Mark batch Don&apos;t import
                </Button>
                {pageCount > 1 && (
                  <>
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
                  </>
                )}
              </div>
            </div>

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
                                <span className={existing.isEncrypted ? "text-muted" : undefined}>
                                  {existing.isEncrypted
                                    ? ENCRYPTED_TITLE_PLACEHOLDER
                                    : existing.title}
                                </span>
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
                                disabled={isBusy || existing.isLocked || existing.isEncrypted}
                                onClick={() => void openQuickEdit(existing.id, group.date)}
                                title={
                                  existing.isLocked
                                    ? "This entry is locked — unlock it before editing"
                                    : existing.isEncrypted
                                      ? "This entry is encrypted — open it from the Journal to edit it"
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

      {/* While the file is being parsed. Same shape as the import dialog below
          and for the same reasons: a large export takes a noticeable moment on
          the server, and until this existed the screen simply sat there with a
          disabled file input and four unchanged cards.

          Suppressed while a write is in flight so it can't stack on the import
          dialog — `runImport` raises `isBusy` too, but never `isParsing`, so the
          two are already exclusive; this is belt and braces for a future caller.

          The bar is indeterminate for the reason the import's is: parsing is one
          server action that returns only when it's done, so a percentage here
          would be invented. */}
      {isParsing && importingCount === undefined && (
        <Modal
          title="Reading the calendar"
          size="sm"
          isBusy
          onClose={() => {
            /* Not dismissable while parsing — the read owns this dialog. */
          }}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">Please wait, parsing the ics file...</p>
            <Progress3D value={undefined} ariaLabel="Calendar parse progress" />
            <p className="text-xs text-muted">
              A calendar export covering years can hold thousands of events. The list below
              fills in once the file has been read.
            </p>
          </div>
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
