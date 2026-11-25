// The Journal Calendar screen: a month, week or year grid of entry titles, the
// clicked day's entries listed beneath it, and a Jump control.
//
// Presentation only. Every date computation — grid shape, padding, ‹ › stepping,
// the 30-character title elision, parsing a typed date — comes from
// `@/lib/journal`'s calendar module, so this file holds no arithmetic. What
// remains here is markup, the URL writes, and view state (which day's entries
// are open, whether the Jump popover is showing).
//
// The scope, the anchor and the selected day live in the URL rather than in
// state, so a particular month with a day open is linkable and survives a
// refresh — modules.md step 8. Navigation is a router push, and the server
// re-reads the range.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { FullscreenStage } from "@/components/fullscreen-stage";
import type { TintColor } from "@/lib/shared/tint";
import { Modal } from "@/components/modal";
import { PhotoOfTheDayButton } from "@/components/photo-of-the-day";
import { SlotIcon } from "@/components/slot-icon";
import { useIsCompact } from "@/components/viewport-context";
import { getIconSlot } from "@/lib/icons";
import {
  CALENDAR_CELL_TITLE_LIMIT,
  CALENDAR_CELL_TITLE_LIMIT_COMPACT,
  CALENDAR_CELL_TITLE_LIMIT_DISPLAY,
  DEFAULT_JOURNAL_DATE_FORMAT,
  ENCRYPTED_TITLE_PLACEHOLDER,
  JOURNAL_DATE_FORMATS,
  WEEKDAY_LABELS,
  calendarHeatLevel,
  buildMonthGrid,
  buildRollingGrid,
  buildWeekGrid,
  buildYearGrid,
  emptyFilter,
  endOfMonth,
  formatCalendarDayHeading,
  formatJumpDate,
  isJournalDateFormat,
  parseJumpDate,
  shiftCalendarAnchor,
  startOfMonth,
  type CalendarCategoryColors,
  type CalendarDay,
  type CalendarWeek,
  type JournalCalendarScope,
  type AdjacentEntryDirection,
  type JournalDateFormat,
  type JournalEntry,
} from "@/lib/journal";
import { BulkConfirm } from "@/components/bulk-confirm";
import { adjacentEntryDateAction, recycleJournalEntryAction } from "./journal-actions";
import {
  deleteJournalEntriesAction,
  bulkLockJournalEntriesAction,
  type BulkRefreshScope,
} from "./journal-bulk-actions";
import {
  JournalMergeDialogs,
  useJournalMerge,
  type MergeFormOptions,
} from "./journal-merge-flow";
import { JournalDayExpenses } from "./journal-day-expenses";
import { JournalPhotosHost } from "./journal-photos-host";
import { JournalOnThisDayDialog } from "./journal-on-this-day-dialog";
import { TaxonomyChipRow } from "@/components/taxonomy-icon";
import { TreeIcon } from "@/components/tree-icons";

/**
 * What the photo dialog is currently showing — one day, or a whole period.
 *
 * One piece of state for both buttons rather than two, so the two can never be open at
 * once. Cleared to `undefined` when the dialog closes, which is what returns the reader
 * to the calendar.
 */
type PhotoRequest = { kind: "day"; date: string } | { kind: "range"; from: string; to: string };

/** Remembers the reader's Jump format between visits — a habit, not domain data. */
const JUMP_FORMAT_STORAGE_KEY = "myhomebase:journal-calendar-jump-format";

// The $ on the open day's panel. Resolved once at module scope — `getIconSlot`
// is a lookup over a frozen table, not a hook.
const DAY_EXPENSES_SLOT = getIconSlot("journal_calendar_day_expenses")!;

export interface JournalCalendarViewProps {
  scope: JournalCalendarScope;
  /** Any day inside the period being shown, "YYYY-MM-DD". */
  anchor: string;
  /** Today, resolved on the server so the highlight matches the server's day. */
  today: string;
  /** The clicked day, if the URL carries one. */
  selectedDate?: string;
  /** Every entry in the visible range, from listEntriesInDateRange. */
  entries: JournalEntry[];
  /** Category/tag name → icon URL, for the viewer dialog. */
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  /**
   * Whether this reader has been granted the Expense module. False hides the
   * open day's $ button. Decided on the server by `JournalCalendarPanel`; the
   * guard that matters is `requireModuleAccess` inside the action behind it.
   */
  canSeeExpense?: boolean;
  /** Category → tint key, for the entry dots (migration 0172). */
  categoryColors?: CalendarCategoryColors;
  /** What the Merge bulk action's entry form needs, read on the server. */
  mergeFormOptions: MergeFormOptions;
}

/**
 * How often Display mode re-reads the period from the server. A wall display is
 * left up for hours: this is what makes a new entry appear without a touch, and
 * moves "today" (and the rolling 5-week window) on at midnight.
 */
const DISPLAY_REFRESH_MS = 15 * 60 * 1000;

export function JournalCalendarView({
  scope,
  anchor,
  today,
  selectedDate,
  entries,
  categoryIcons,
  tagIcons,
  canSeeExpense = false,
  categoryColors,
  mergeFormOptions,
}: JournalCalendarViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCompact = useIsCompact();

  /** Which photos the Photo of the Day dialog is showing, if it is open. */
  const [photoRequest, setPhotoRequest] = useState<PhotoRequest | undefined>(undefined);
  /**
   * Which day the expenses dialog is showing, if it is open.
   *
   * The date rather than a boolean, so the dialog cannot outlive the day it was
   * opened from: closing the day panel clears it, and a reader who opens a
   * different day gets a dialog keyed to that day rather than a stale total.
   */
  const [expensesDate, setExpensesDate] = useState<string | undefined>(undefined);
  /**
   * Which cell's "Today in history" dialog is open, if any.
   *
   * The date rather than a boolean, for the reason `expensesDate` is one: the
   * dialog must not outlive the cell it was raised from. Only the month and day
   * are used — the year is along for the ride so the dialog can name the date
   * the reader actually pressed.
   *
   * Independent of `selectedDate` on purpose. The question is about a month and
   * a day across every year, not about the open day, so pressing it does not
   * select the cell and closing the day panel does not close it.
   */
  const [historyDate, setHistoryDate] = useState<string | undefined>(undefined);
  /**
   * Which direction has already been found to have nothing left, so its button
   * can go dead rather than re-asking on every press. Cleared by any navigation,
   * because from a new day the answer may well be different.
   */
  const [exhausted, setExhausted] = useState<Partial<Record<AdjacentEntryDirection, boolean>>>({});
  /** The jump in flight, if any — both buttons wait while one is running. */
  const [jumping, setJumping] = useState<AdjacentEntryDirection | undefined>(undefined);

  // The three grids come straight from the library; this component never walks a
  // calendar itself. Memoized because the year scope builds 12 × 42 cells and the
  // inputs only change on a navigation.
  const monthOrWeekGrid = useMemo(() => {
    const options = { anchor, entries, today, selectedDate, categoryColors };
    if (scope === "week") return buildWeekGrid(options);
    if (scope === "weeks") return buildRollingGrid(options);
    if (scope === "month") return buildMonthGrid(options);
    return undefined;
  }, [scope, anchor, entries, today, selectedDate, categoryColors]);
  const yearGrid = useMemo(
    () =>
      scope === "year"
        ? buildYearGrid({ anchor, entries, today, selectedDate, categoryColors })
        : undefined,
    [scope, anchor, entries, today, selectedDate, categoryColors],
  );

  /** Whether the grid is on the fullscreen Display stage. */
  const [isDisplay, setIsDisplay] = useState(false);

  // While on the Display stage, re-read the period every 15 minutes. A server
  // refresh rather than a client clock: "today" and the entries both come from
  // the server, so this is the one call that brings both up to date.
  useEffect(() => {
    if (!isDisplay) return;
    const timer = window.setInterval(() => router.refresh(), DISPLAY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isDisplay, router]);

  const title = monthOrWeekGrid?.title ?? yearGrid?.title ?? "";
  const entryCount = monthOrWeekGrid?.entryCount ?? yearGrid?.entryCount ?? 0;

  const selectedEntries = useMemo(
    () =>
      selectedDate === undefined
        ? []
        : entries
            .filter((entry) => entry.date === selectedDate)
            .sort((a, b) => {
              // Same ordering the cells use: timed first, then by id.
              if (a.time === "" && b.time === "") return a.id - b.id;
              if (a.time === "") return 1;
              if (b.time === "") return -1;
              return a.time === b.time ? a.id - b.id : a.time.localeCompare(b.time);
            }),
    [entries, selectedDate],
  );

  /** Rewrites the URL's calendar params, dropping the ones left undefined. */
  function navigate(next: {
    scope?: JournalCalendarScope;
    anchor?: string;
    date?: string | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.scope !== undefined) params.set("scope", next.scope);
    if (next.anchor !== undefined) params.set("anchor", next.anchor);
    if (next.date === null) params.delete("date");
    else if (next.date !== undefined) params.set("date", next.date);
    // Any move resets the « » buttons: "no earlier entry" was an answer about the
    // day we were on, and from a different day it may not hold.
    setExhausted({});
    router.push(`${pathname}?${params.toString()}`);
  }

  /**
   * Clicking a day selects it; clicking the selected day again clears it. A
   * padding day also moves the anchor, so clicking into next month's tail takes
   * you there rather than selecting a day you can't see in context.
   */
  function selectDay(day: CalendarDay) {
    if (day.isSelected) {
      navigate({ date: null });
      return;
    }
    navigate({ date: day.date, ...(day.isCurrentPeriod ? {} : { anchor: day.date }) });
  }

  /**
   * Walks to the previous/next day that actually has an entry.
   *
   * Starts from the open day when there is one, otherwise the anchor: with
   * nothing clicked, "next" sensibly means "the next entry after the period I'm
   * looking at the start of". The search itself is a server round-trip because
   * the grid only holds this period's entries and the answer may be months away.
   */
  async function jumpToAdjacentEntry(direction: AdjacentEntryDirection) {
    if (jumping !== undefined) return;
    setJumping(direction);
    try {
      const result = await adjacentEntryDateAction(selectedDate ?? anchor, direction);
      if (result.ok && result.date !== undefined) {
        // Same move the Jump box makes: land on the day AND open it, because
        // "go to the next entry" is a request to read it, not just to see its month.
        navigate({ anchor: result.date, date: result.date });
        return;
      }
      // No entry that way (or the read failed): mark the direction spent so the
      // button greys out and says why, rather than silently doing nothing.
      setExhausted((current) => ({ ...current, [direction]: true }));
    } finally {
      setJumping(undefined);
    }
  }

  const cellTitleLimit = isCompact ? CALENDAR_CELL_TITLE_LIMIT_COMPACT : CALENDAR_CELL_TITLE_LIMIT;
  /**
   * Opens an entry on its own screen. Not a dialog: the calendar is for finding an
   * entry, and the full screen is where it is read, edited and linked from.
   */
  function openEntry(id: number) {
    router.push(`/modules/journal/entries/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <CalendarToolbar
        scope={scope}
        anchor={anchor}
        today={today}
        title={title}
        entryCount={entryCount}
        onScope={(nextScope) => navigate({ scope: nextScope })}
        onStep={(delta) => navigate({ anchor: shiftCalendarAnchor(scope, anchor, delta) })}
        onToday={() => navigate({ anchor: today, date: today })}
        onPhotosOfPeriod={() =>
          // The whole month the anchor falls in, not the grid's padded span: a reader
          // pressing this on August wants August, not the last days of July that the
          // 6×7 grid happens to show. Both bounds come from the library.
          setPhotoRequest({
            kind: "range",
            from: startOfMonth(anchor),
            to: endOfMonth(anchor),
          })
        }
        onJump={(date) => {
          // A jump both moves the period and opens that day — typing a date is
          // asking "what did I write then?", not just "show me that month".
          navigate({ anchor: date, date });
        }}
        onJumpToEntry={(direction) => void jumpToAdjacentEntry(direction)}
        jumping={jumping}
        exhausted={exhausted}
        onDisplay={() => setIsDisplay(true)}
      />

      {monthOrWeekGrid ? (
        <MonthGrid
          weeks={monthOrWeekGrid.weeks}
          cellTitleLimit={cellTitleLimit}
          variant={monthOrWeekGrid.scope}
          onSelectDay={selectDay}
          onOpenEntry={openEntry}
          onOpenPhotos={(date) => setPhotoRequest({ kind: "day", date })}
          onOpenHistory={setHistoryDate}
        />
      ) : null}

      {isDisplay ? (
        // The real Fullscreen API via the shared stage, as the chart and the entry
        // editor do — no toolbar, no shell, no browser chrome. Escape exits (the
        // browser owns that key), and the stage reports it. The page's own grid
        // stays mounted underneath; nothing here is hidden-and-duplicated on the
        // same screen, because the stage covers the whole display.
        <FullscreenStage
          label="Journal calendar"
          onExit={() => setIsDisplay(false)}
          className="overflow-auto bg-paper p-6"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-4xl font-light text-ink">{title}</h2>
              <p className="text-sm text-muted">Esc to leave</p>
            </div>
            {monthOrWeekGrid ? (
              // Read-only on the stage: the entry viewer, the day panel and the
              // photo dialog all render outside the fullscreened element, so
              // opening one here would put it behind the display, unseen.
              <MonthGrid
                weeks={monthOrWeekGrid.weeks}
                cellTitleLimit={CALENDAR_CELL_TITLE_LIMIT_DISPLAY}
                variant={monthOrWeekGrid.scope}
                isDisplay
                onSelectDay={() => undefined}
                onOpenEntry={() => undefined}
                onOpenPhotos={() => undefined}
                onOpenHistory={() => undefined}
              />
            ) : null}
            {yearGrid ? (
              <div className="card-grid gap-4">
                {yearGrid.months.map((month) => (
                  <MiniMonth
                    key={month.month}
                    label={month.label}
                    weeks={month.weeks}
                    entryCount={month.entryCount}
                    maxDayEntryCount={yearGrid.maxDayEntryCount}
                    onSelectDay={() => undefined}
                    // Opening a month is a change of scope, which stays on the
                    // stage — the one navigation that is visible from here.
                    onOpenMonth={() => navigate({ scope: "month", anchor: `${month.year}-${String(month.month).padStart(2, "0")}-01` })}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </FullscreenStage>
      ) : null}

      {yearGrid ? (
        <div className="flex flex-col gap-3">
          <div className="card-grid gap-4">
            {yearGrid.months.map((month) => (
              <MiniMonth
                key={month.month}
                label={month.label}
                weeks={month.weeks}
                entryCount={month.entryCount}
                maxDayEntryCount={yearGrid.maxDayEntryCount}
                onSelectDay={selectDay}
                onOpenMonth={() => navigate({ scope: "month", anchor: `${month.year}-${String(month.month).padStart(2, "0")}-01` })}
              />
            ))}
          </div>
          <HeatLegend maxDayEntryCount={yearGrid.maxDayEntryCount} />
        </div>
      ) : null}

      {selectedDate ? (
        <DayEntriesPanel
          // Keyed by the day so the ticks never carry over to another day's list.
          key={selectedDate}
          date={selectedDate}
          mergeFormOptions={mergeFormOptions}
          entries={selectedEntries}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          onOpenEntry={openEntry}
          onClose={() => {
            // The dialog belongs to the open day, so closing the day closes it
            // too — otherwise it would hang over a calendar with nothing selected.
            setExpensesDate(undefined);
            navigate({ date: null });
          }}
          onOpenExpenses={canSeeExpense ? () => setExpensesDate(selectedDate) : undefined}
        />
      ) : null}

      {expensesDate ? (
        // Keyed by the day, for the reason the photo dialog above is: pressing a
        // different day's button while one is open must remount rather than
        // leave the first day's figures under a new heading.
        <JournalDayExpenses
          key={expensesDate}
          date={expensesDate}
          onClose={() => setExpensesDate(undefined)}
        />
      ) : null}

      {historyDate ? (
        // Keyed by the date, like the two dialogs around it: pressing another
        // cell's button while one is open must remount rather than leave the
        // first date's list sitting under a new heading.
        //
        // Not drawn from the Display stage — that grid renders no controls at
        // all, because a dialog raised there would open *behind* the fullscreened
        // element and be invisible.
        <JournalOnThisDayDialog
          key={historyDate}
          date={historyDate}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          formOptions={mergeFormOptions}
          onClose={() => setHistoryDate(undefined)}
        />
      ) : null}

      {photoRequest ? (
        // Keyed by what it is showing, so pressing a different day's button while one
        // is open remounts the dialog rather than leaving the first scan's results in
        // place under a new title.
        <JournalPhotosHost
          key={photoRequest.kind === "day" ? photoRequest.date : `${photoRequest.from}..${photoRequest.to}`}
          date={photoRequest.kind === "day" ? photoRequest.date : undefined}
          range={
            photoRequest.kind === "range"
              ? { from: photoRequest.from, to: photoRequest.to }
              : undefined
          }
          // The button press WAS the "go and look" instruction here, unlike the entry
          // card where the card renders whether or not anyone wants photos.
          autoLookup
          onClose={() => setPhotoRequest(undefined)}
        />
      ) : null}
    </div>
  );
}

// --- Toolbar -----------------------------------------------------------------

function CalendarToolbar({
  scope,
  anchor,
  today,
  title,
  entryCount,
  onScope,
  onStep,
  onToday,
  onPhotosOfPeriod,
  onJump,
  onJumpToEntry,
  jumping,
  exhausted,
  onDisplay,
}: {
  scope: JournalCalendarScope;
  anchor: string;
  today: string;
  title: string;
  entryCount: number;
  onScope: (scope: JournalCalendarScope) => void;
  onStep: (delta: number) => void;
  onToday: () => void;
  onPhotosOfPeriod: () => void;
  onJump: (date: string) => void;
  onJumpToEntry: (direction: AdjacentEntryDirection) => void;
  jumping?: AdjacentEntryDirection;
  exhausted: Partial<Record<AdjacentEntryDirection, boolean>>;
  onDisplay: () => void;
}) {
  // 5 Weeks slides one week per press, so its steppers say "week" too.
  const stepLabel =
    scope === "week" || scope === "weeks" ? "week" : scope === "year" ? "year" : "month";

  return (
    // Three groups: the two period-independent actions anchor left, the period
    // itself (steppers + title) sits in the middle, the range switch and help
    // close the right. The flex-1 spacers are what keep the middle centred when
    // the two ends are different widths.
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onToday}>
          Today
        </Button>
        <JumpControl anchor={anchor} today={today} onJump={onJump} />
      </div>

      <div className="flex-1 max-lg:hidden" />

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onStep(-1)}
          ariaLabel={`Previous ${stepLabel}`}
          title={`Previous ${stepLabel}`}
        >
          ‹
        </Button>
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold text-ink">{title}</h3>
          <p className="text-xs text-muted">
            {entryCount === 1 ? "1 entry" : `${entryCount} entries`}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onStep(1)}
          ariaLabel={`Next ${stepLabel}`}
          title={`Next ${stepLabel}`}
        >
          ›
        </Button>
        {/* Beside the steppers because it acts on the same thing they do — the period
            currently shown. It always means the anchor's whole MONTH, in every scope:
            "photos of the week" is what the individual day buttons already answer, and
            a year of photo folders is a list nobody reads. */}
        <PhotoOfTheDayButton
          hint="Get photos of the month"
          onOpen={onPhotosOfPeriod}
          className="h-8 w-8 border border-line bg-paper max-lg:h-9 max-lg:w-9"
        />
        {/* Double chevrons, deliberately next to the single ones: ‹ › step by a
            fixed period whether or not anything is there, « » skip to where the
            writing actually is. Disabled once a direction has come back empty —
            you are at that end of the journal, and a second press can't help. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onJumpToEntry("prev")}
          disabled={jumping !== undefined || exhausted.prev === true}
          ariaLabel="Jump to previous entry on calendar"
          title={
            exhausted.prev === true
              ? "No earlier entry"
              : "Jump to previous entry on calendar"
          }
          className="max-lg:px-4 max-lg:py-2"
        >
          «
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onJumpToEntry("next")}
          disabled={jumping !== undefined || exhausted.next === true}
          ariaLabel="Jump to next entry on calendar"
          title={exhausted.next === true ? "No later entry" : "Jump to next entry on calendar"}
          className="max-lg:px-4 max-lg:py-2"
        >
          »
        </Button>
      </div>

      <div className="flex-1 max-lg:hidden" />

      <div className="flex flex-wrap items-center gap-2">
        <ScopeSwitch scope={scope} onScope={onScope} />
        {/* Desktop only. An iPhone can't fullscreen part of a page, and a phone is
            not a wall display. The same text glyph the chart's fullscreen button
            uses: an action, so no icon slot. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onDisplay}
          ariaLabel="Show the calendar full screen"
          title="Show the calendar full screen, as a wall display"
          className="max-lg:hidden"
        >
          ⛶ Display
        </Button>
        <Comments
          title="Using the calendar"
          content={
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                Each day shows its entry titles, cut to the first 30 characters — hover a
                title for the whole thing.
              </li>
              <li>Click a day to list its entries below the grid; click it again to close.</li>
              <li>Click a title to open that entry on its own screen.</li>
              <li>
                Tick entries in a day&apos;s list (or Select all) to Merge, Lock, Unlock or
                Delete them together. Merge skips locked entries; Delete moves them to the
                recycle bin.
              </li>
              <li>
                Week, 5 Weeks, Month and Year are the ranges; ‹ and › step by whichever one
                is showing — except 5 Weeks, which slides one week at a time. In 5 Weeks the
                1st of each month shows the month&apos;s name instead of &ldquo;1&rdquo;.
              </li>
              <li>
                The dot before a title takes the colour of the entry&apos;s first coloured
                category. Pick a category&apos;s colour in Categories → Edit.
              </li>
              <li>
                Display (wide screens) shows the calendar full screen, for a wall. It
                refreshes itself every 15 minutes; press Esc to leave.
              </li>
              <li>
                « and » skip to the previous or next day that has an entry, however far
                away it is — they start from the day you have open, or from the period
                showing if none is.
              </li>
              <li>
                The jump button takes a typed date — pick the format it should be read in, or
                use the picker.
              </li>
              <li>
                In the year view a darker square means a busier day; the legend underneath
                says how many entries the darkest shade stands for.
              </li>
              <li>A pushpin marks a pinned entry and a padlock a locked one.</li>
              <li>
                On a wide screen, hover a day to show its + (a new entry dated that day) and
                its picture button.
              </li>
              <li>
                The picture button on a day shows the photographs filed under that date;
                the one beside ‹ › does the same for the whole month.
              </li>
            </ul>
          }
        />
      </div>
    </div>
  );
}

function ScopeSwitch({
  scope,
  onScope,
}: {
  scope: JournalCalendarScope;
  onScope: (scope: JournalCalendarScope) => void;
}) {
  const options: { value: JournalCalendarScope; label: string }[] = [
    { value: "week", label: "Week" },
    { value: "weeks", label: "5 Weeks" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
  ];
  return (
    // A segmented control rather than a row of Buttons: these are one setting's
    // states, and a row of switch-styled buttons would read as three actions.
    <div
      role="group"
      aria-label="Calendar range"
      className="flex overflow-hidden rounded-lg border border-line"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={scope === option.value}
          onClick={() => onScope(option.value)}
          className={`px-3 py-1.5 text-sm transition-colors max-lg:py-2 ${
            scope === option.value
              ? "bg-brass text-paper"
              : "bg-paper-raised text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Jump control: a glyph that opens a popover holding a typed date, the
 * format that date is read in, and a native picker as an alternative.
 *
 * Both inputs on purpose. The typed box with an explicit format is the reliable
 * path — it never guesses whether 01/02 is January or February — and the picker
 * is the quick one when the reader would rather not type at all.
 */
function JumpControl({
  anchor,
  today,
  onJump,
}: {
  anchor: string;
  today: string;
  onJump: (date: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<JournalDateFormat>(DEFAULT_JOURNAL_DATE_FORMAT);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus and select the typed box when it mounts — the popover only renders
  // while open, so "mounted" and "just opened" are the same moment. This ref has
  // to be stable: an inline arrow is a new identity each render, so React would
  // detach and re-attach it after *every* keystroke and re-select the whole box,
  // making the next character replace what was already typed instead of appending.
  const focusTypedBox = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    node?.select();
  }, []);

  /**
   * Opens the popover, seeding it from the remembered format and the period we
   * are already on — the reader edits a date rather than composing one.
   *
   * Both reads happen in the click handler rather than in an effect. localStorage
   * doesn't exist on the server, so it can't be read during render; and doing it
   * on open (the only moment the values matter) avoids the cascading re-render an
   * effect that only calls setState would cause.
   */
  function open() {
    const stored = window.localStorage.getItem(JUMP_FORMAT_STORAGE_KEY);
    const nextFormat = stored && isJournalDateFormat(stored) ? stored : format;
    setFormat(nextFormat);
    setText(formatJumpDate(anchor, nextFormat));
    setError(undefined);
    setIsOpen(true);
  }

  // Escape closes, and so does a click outside — the same dismissal a reader
  // expects of any popover. Only wired while open.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  function chooseFormat(next: JournalDateFormat) {
    // Re-render the text in the new format rather than reinterpreting the digits:
    // switching the format shouldn't silently change which day is in the box.
    const parsed = parseJumpDate(text, format);
    setFormat(next);
    window.localStorage.setItem(JUMP_FORMAT_STORAGE_KEY, next);
    setText(parsed.ok ? formatJumpDate(parsed.date, next) : "");
    setError(undefined);
  }

  function submit() {
    const parsed = parseJumpDate(text, format);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setIsOpen(false);
    onJump(parsed.date);
  }

  // The picker mirrors the typed box when that box holds a readable date, and is
  // left blank otherwise — showing a stale day while the text says something else
  // would make the two controls disagree.
  const parsedText = parseJumpDate(text, format);
  const pickerValue = parsedText.ok ? parsedText.date : "";

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        ariaLabel="Jump to a date"
        title="Jump to a date"
        ariaExpanded={isOpen}
        ariaControls="journal-calendar-jump"
      >
        <JumpIcon />
      </Button>

      {isOpen ? (
        <div
          id="journal-calendar-jump"
          className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-line bg-paper-raised p-4 card-raised max-lg:fixed max-lg:left-3 max-lg:right-3 max-lg:w-auto"
        >
          <label
            htmlFor="journal-jump-date"
            className="block text-xs font-medium uppercase tracking-wide text-muted"
          >
            Jump to date
          </label>
          <div className="mt-2 flex gap-2">
            <input
              ref={focusTypedBox}
              autoFocus
              id="journal-jump-date"
              type="text"
              inputMode="numeric"
              value={text}
              placeholder={format}
              aria-describedby="journal-jump-error"
              onChange={(event) => {
                setText(event.target.value);
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-muted"
            />
            <select
              aria-label="Date format"
              value={format}
              onChange={(event) => chooseFormat(event.target.value as JournalDateFormat)}
              className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink"
            >
              {JOURNAL_DATE_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p id="journal-jump-error" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          ) : (
            <p id="journal-jump-error" className="mt-2 text-xs text-muted">
              Type a date as {format}, or pick one below.
            </p>
          )}

          {/* The picker alternative. The browser draws this in its own locale, so
              it is deliberately separate from the typed box rather than styled to
              match — pretending otherwise would look broken on some devices. */}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              aria-label="Pick a date"
              value={pickerValue}
              onChange={(event) => {
                const picked = event.target.value;
                if (picked === "") return;
                setIsOpen(false);
                onJump(picked);
              }}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
          </div>

          <div className="mt-4 flex justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={() => onJump(today)}>
              Today
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit}>
                Go
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** An arrow leaving a bracket — "jump to". */
function JumpIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M11 4h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4" strokeLinecap="round" />
      <path d="M3 10h9M9 6.5 12.5 10 9 13.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// --- Month / week / 5-week grid ----------------------------------------------

/** Which grid shape a MonthGrid is drawing — decides cell height and day labels. */
type GridVariant = "month" | "week" | "weeks";

/**
 * The dot class for each tint key. Spelled out, not interpolated: Tailwind and the
 * CSS bundle are scanned as source text, so `clip-tint-${key}` would never be
 * emitted. `""` is the default dot, which `.tint-dot` draws in the theme accent.
 */
const DOT_CLASS = {
  "": "tint-dot",
  rose: "tint-dot clip-tint-rose",
  amber: "tint-dot clip-tint-amber",
  sage: "tint-dot clip-tint-sage",
  ocean: "tint-dot clip-tint-ocean",
  indigo: "tint-dot clip-tint-indigo",
  slate: "tint-dot clip-tint-slate",
} satisfies Record<TintColor | "", string>;

function MonthGrid({
  weeks,
  cellTitleLimit,
  variant,
  isDisplay = false,
  onSelectDay,
  onOpenEntry,
  onOpenPhotos,
  onOpenHistory,
}: {
  weeks: CalendarWeek[];
  cellTitleLimit: number;
  variant: GridVariant;
  /** Drawn inside the fullscreen Display stage: taller cells, no hover controls. */
  isDisplay?: boolean;
  onSelectDay: (day: CalendarDay) => void;
  onOpenEntry: (id: number) => void;
  onOpenPhotos: (date: string) => void;
  onOpenHistory: (date: string) => void;
}) {
  return (
    // Gridlines are back: every cell draws its right and bottom edge and the grid
    // draws the left and top, so neighbouring cells share one 1px line rather than
    // doubling it. The fills that mean something stay: the open day, and the dimmed
    // days a month grid borrows from its neighbours.
    <div className="flex flex-col gap-1">
      {/* The weekday row pops off the page: a raised bar with a drop shadow, using
          design.md's registered `.card-raised` lift rather than a hand-rolled
          shadow. `relative z-10` keeps the cast above the day cells that follow it
          in the DOM, and the extra bottom margin leaves room for it to read. */}
      <div className="card-raised relative z-10 mb-2 grid grid-cols-7 gap-1 rounded-lg bg-paper-raised">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className={`px-2 py-2 text-center font-medium uppercase tracking-wide text-muted ${
              isDisplay ? "text-lg" : "text-xs"
            }`}
          >
            {/* One letter narrow: seven three-letter labels don't fit a phone. */}
            <span className="max-lg:hidden">{label}</span>
            <span className="lg:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-t border-line">
        {weeks.flatMap((week) =>
          week.days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              titleLimit={cellTitleLimit}
              variant={variant}
              isDisplay={isDisplay}
              onSelect={() => onSelectDay(day)}
              onOpenEntry={onOpenEntry}
              onOpenPhotos={() => onOpenPhotos(day.date)}
              onOpenHistory={() => onOpenHistory(day.date)}
            />
          )),
        )}
      </div>
    </div>
  );
}

/** Cell heights per grid. The 5-week and month grids share a row height. */
function cellHeightClass(variant: GridVariant, isDisplay: boolean): string {
  if (isDisplay) {
    // Fill the screen: a fullscreen stage has no toolbar, so the rows split the
    // viewport between them (minus the heading and weekday strip).
    return variant === "week" ? "min-h-[70vh]" : variant === "weeks" ? "min-h-[15vh]" : "min-h-[12.5vh]";
  }
  return variant === "week" ? "min-h-40" : "min-h-24 max-lg:min-h-16";
}

function DayCell({
  day,
  titleLimit,
  variant,
  isDisplay,
  onSelect,
  onOpenEntry,
  onOpenPhotos,
  onOpenHistory,
}: {
  day: CalendarDay;
  titleLimit: number;
  variant: GridVariant;
  isDisplay: boolean;
  onSelect: () => void;
  onOpenEntry: (id: number) => void;
  onOpenPhotos: () => void;
  /** Raises "In history on …" for this cell's month and day, across every year. */
  onOpenHistory: () => void;
}) {
  const shown = day.entries.slice(0, titleLimit);
  const hidden = day.entries.length - shown.length;
  // The rolling view has no month heading per row, so the 1st says which month
  // it starts ("Nov") in place of its number — the screenshot's wall-calendar cue.
  const dayLabel =
    variant === "weeks" && day.monthLabel !== undefined ? day.monthLabel : String(day.dayOfMonth);

  return (
    // The cell itself is the click target for "select this day". The titles
    // inside are their own buttons, so a click on a title opens that entry
    // instead of just selecting the day — hence stopPropagation there.
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={`${day.date}, ${day.entries.length} entries`}
      aria-selected={day.isSelected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      // `group` is what the hover-revealed controls (the +, the Today in history
      // button and the photo button) key off on desktop.
      className={`group flex min-w-0 cursor-pointer flex-col gap-1 border-b border-r border-line p-1.5 text-left transition-colors ${cellHeightClass(
        variant,
        isDisplay,
      )} ${
        day.isSelected
          ? "bg-brass-soft ring-2 ring-inset ring-brass"
          : day.isCurrentPeriod
            ? "hover:bg-paper-raised"
            : "bg-paper-raised/20 hover:bg-paper-raised"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        {/* The day number carries its own entry count, as a badge on the number's
            shoulder. It used to be a faint `brass-soft` chip over in the controls
            on the right, where it read as one more piece of cell chrome among the
            + and the photo button; a count is a property OF the day, so it sits on
            the day. The wrapper is what the badge positions against — the number
            itself can't be `relative` without its own circle moving. `inline-flex`
            rather than the default `inline`, so the wrapper's box is exactly the
            number's circle: an inline box is sized by line-height, which would put
            the badge's corner somewhere that moves with the font. */}
        <span className="relative inline-flex shrink-0">
          <span
            className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-light leading-none ${
              isDisplay ? "h-14 min-w-14 px-2 text-4xl" : "h-9 min-w-9 px-1 text-2xl max-lg:h-7 max-lg:min-w-7 max-lg:text-base"
            } ${
              day.isToday
                ? // Today is a large filled accent circle — the one thing on the grid
                  // that must be findable without reading any numbers.
                  "bg-brass font-normal text-paper"
                : day.isCurrentPeriod
                  ? "text-ink"
                  : "text-muted opacity-60"
            }`}
          >
            {dayLabel}
          </span>
          {day.entries.length > 0 ? (
            // `bg-brass` + `text-paper`, the same pair today's filled circle uses —
            // proven to carry in all nine themes, which a one-off shade would not
            // be. The `ring-paper` is what keeps it legible when it lands ON that
            // circle: without it, today's badge would dissolve into the brass
            // underneath it. Decorative — the cell's aria-label already counts the
            // entries in words, so announcing the number again would say it twice.
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute flex items-center justify-center rounded-full bg-brass font-semibold text-paper ring-2 ring-paper ${
                isDisplay
                  ? "-right-2 -top-1 h-7 min-w-7 px-1.5 text-base"
                  : "-right-1 -top-1 h-4 min-w-4 px-1 text-[10px] max-lg:-right-0.5 max-lg:h-3.5 max-lg:min-w-3.5 max-lg:px-0.5 max-lg:text-[9px]"
              }`}
            >
              {day.entries.length}
            </span>
          ) : null}
        </span>
        {isDisplay ? null : (
          <span className="flex shrink-0 items-center gap-1">
            {/* Start a new entry already dated to this day. Desktop only, revealed on
                hover/focus like the two buttons beside it: a phone cell has no room for a
                third control, and the open day's panel already has New entry.
                A link, so it opens in a new tab like any other. stopPropagation on
                both click and key: the cell itself selects the day on click AND
                swallows Enter, which would otherwise eat the link's activation. */}
            <Link
              href={`/modules/journal/new-entry?date=${day.date}`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label={`New entry on ${day.date}`}
              title="New entry on this day"
              className={`rounded p-0.5 text-muted transition-opacity hover:bg-brass-soft hover:text-brass-dark focus-visible:opacity-100 max-lg:hidden ${
                day.isSelected ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
            >
              <TreeIcon name="plus" className="h-3.5 w-3.5" />
            </Link>
            {/* "What else did I write on this date, in any year?" — the one control
                here that is NOT about this cell's own day, so it is on every cell
                whether or not this year's square has anything in it: an empty
                November 24 is often exactly when the question is worth asking.

                Shown the way the photo button is, and for the same reasons — hidden
                until hover or focus on desktop so 42 of them don't compete with the
                titles, always visible on a phone, which has no hover. It fits
                because the entry count moved onto the day number above, so the cell
                still carries the two controls it carried before.

                A row action, not a place, so a bare `TreeIcon` and no icon slot —
                coding-guide.md keeps row actions out of the registry, the same call
                the `+` link above it makes. stopPropagation because the cell itself
                selects the day on click and swallows Enter. */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenHistory();
              }}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label={`Today in history for ${day.date}`}
              title="Today in history — this date in every year"
              className={`rounded p-0.5 text-muted transition-opacity hover:bg-brass-soft hover:text-brass-dark focus-visible:opacity-100 ${
                day.isSelected
                  ? ""
                  : "lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
              }`}
            >
              <TreeIcon name="history" className="h-3.5 w-3.5 max-lg:h-3 max-lg:w-3" />
            </button>
            {/* On EVERY day, not only days with an entry: the archive is filed by date
                independently of the journal, so a day with nothing written can still have
                photographs — which is often exactly why you go looking.

                Desktop hides it until the cell is hovered or focused (or is the open
                day), so 42 identical buttons don't compete with the titles. A phone
                always shows it: a touch screen has no hover and this is the only way to
                reach the photos there. The narrow cell is 16 units tall, so the button
                shrinks instead. The wrapper carries the visibility because the button
                only takes a className for its own sizing. */}
            <span
              className={`inline-flex transition-opacity ${
                day.isSelected
                  ? ""
                  : "lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
              }`}
            >
              <PhotoOfTheDayButton
                hint={`Photos from ${day.date}`}
                onOpen={onOpenPhotos}
                className="max-lg:h-5 max-lg:w-5"
              />
            </span>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {shown.map((entry) => (
          <button
            key={entry.id}
            type="button"
            // The full title is the hint; the label is elided to 30 characters.
            title={entry.title}
            onClick={(event) => {
              event.stopPropagation();
              onOpenEntry(entry.id);
            }}
            className={`truncate rounded px-1 py-0.5 text-left leading-snug text-ink hover:bg-brass-soft hover:text-brass-dark ${
              isDisplay ? "text-base" : "text-[11px]"
            }`}
          >
            {/* The category dot: the entry's first coloured category, or the
                accent. Decorative — the category itself is in the viewer. */}
            <span
              aria-hidden="true"
              className={`mr-1 inline-block rounded-full align-middle ${
                isDisplay ? "h-2 w-2" : "h-1.5 w-1.5"
              } ${DOT_CLASS[entry.color]}`}
            />
            {entry.time === "" ? "" : <span className="text-muted">{entry.time.slice(0, 5)} </span>}
            {/* State markers, not slots — coding-guide.md keeps state glyphs out of
                the icon registry. Inline before the title so they survive the
                one-title phone cell. */}
            {entry.isPinned ? (
              <>
                <TreeIcon name="pushpin" className="mr-0.5 inline-block h-2.5 w-2.5 align-[-1px] text-brass-dark" />
                <span className="sr-only">Pinned. </span>
              </>
            ) : null}
            {entry.isLocked ? (
              <>
                <TreeIcon name="lock" className="mr-0.5 inline-block h-2.5 w-2.5 align-[-1px] text-muted" />
                <span className="sr-only">Locked. </span>
              </>
            ) : null}
            {entry.shortTitle}
          </button>
        ))}
        {hidden > 0 ? (
          <span className={`px-1 text-muted ${isDisplay ? "text-sm" : "text-[10px]"}`}>
            +{hidden} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

// --- Year grid ---------------------------------------------------------------

/**
 * The colour for each heat level, indexed 0–CALENDAR_HEAT_LEVELS (so one more
 * entry than there are levels). Shared by the day squares and the legend, so the
 * two can't show different scales.
 */
const HEAT_SHADES: readonly string[] = [
  "bg-paper",
  "bg-brass-soft",
  "bg-brass/40",
  "bg-brass/70",
  "bg-brass",
];

/**
 * "Less ▢▢▢▢▢ More" under the year grid. Because the scale is relative to the
 * busiest day, the swatches alone don't say what "more" means — the count does.
 */
function HeatLegend({ maxDayEntryCount }: { maxDayEntryCount: number }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1" aria-hidden="true">
        Less
        {HEAT_SHADES.map((shade) => (
          <span key={shade} className={`h-3 w-3 rounded-[3px] border border-line ${shade}`} />
        ))}
        More
      </span>
      <span>
        {maxDayEntryCount === 0
          ? "No entries this year"
          : `Busiest day: ${maxDayEntryCount} ${maxDayEntryCount === 1 ? "entry" : "entries"}`}
      </span>
    </div>
  );
}

/**
 * One month of the year view: a 6×7 grid of shaded squares. Titles don't fit at
 * this size, so each day carries them as a tooltip and the count drives the
 * shade; clicking a day still selects it and lists its entries below.
 */
function MiniMonth({
  label,
  weeks,
  entryCount,
  maxDayEntryCount,
  onSelectDay,
  onOpenMonth,
}: {
  label: string;
  weeks: CalendarWeek[];
  entryCount: number;
  maxDayEntryCount: number;
  onSelectDay: (day: CalendarDay) => void;
  onOpenMonth: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={onOpenMonth}
          className="font-display text-sm font-semibold text-ink hover:text-brass"
          title={`Open ${label} in the month view`}
        >
          {label}
        </button>
        <span className="text-xs text-muted">{entryCount}</span>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map((weekday) => (
          <span key={weekday} className="text-center text-[9px] uppercase text-muted">
            {weekday.slice(0, 1)}
          </span>
        ))}
        {weeks.flatMap((week) =>
          week.days.map((day) => (
            <MiniDay
              key={day.date}
              day={day}
              maxDayEntryCount={maxDayEntryCount}
              onSelect={() => onSelectDay(day)}
            />
          )),
        )}
      </div>
    </div>
  );
}

function MiniDay({
  day,
  maxDayEntryCount,
  onSelect,
}: {
  day: CalendarDay;
  maxDayEntryCount: number;
  onSelect: () => void;
}) {
  // The level (0–4, scaled to the busiest day) comes from the library, which the
  // legend reads too; only the colour each level maps to lives here.
  const count = day.entries.length;
  const shade = HEAT_SHADES[calendarHeatLevel(count, maxDayEntryCount)];

  // The tooltip carries what the cell is too small to print: the date and every
  // title on it, full length, with the same pinned/locked marks the month cells
  // draw as glyphs. This is the year view's answer to "hover shows the complete
  // title".
  const hint =
    count === 0
      ? day.date
      : `${day.date}\n${day.entries
          .map(
            (entry) =>
              `${entry.isPinned ? "📌 " : ""}${entry.isLocked ? "🔒 " : ""}` +
              (entry.time === "" ? entry.title : `${entry.time.slice(0, 5)} ${entry.title}`),
          )
          .join("\n")}`;

  return (
    <button
      type="button"
      title={hint}
      onClick={onSelect}
      aria-label={`${day.date}, ${count} entries`}
      className={`aspect-square rounded-[3px] text-[9px] leading-none transition-colors ${shade} ${
        day.isCurrentPeriod ? "" : "opacity-30"
      } ${day.isToday ? "ring-1 ring-inset ring-ink" : ""} ${
        day.isSelected ? "ring-2 ring-inset ring-brass" : "hover:ring-1 hover:ring-inset hover:ring-brass"
      }`}
    >
      <span className="sr-only">{day.dayOfMonth}</span>
    </button>
  );
}

// --- The selected day's entries ----------------------------------------------

function DayEntriesPanel({
  date,
  entries,
  categoryIcons,
  tagIcons,
  onOpenEntry,
  onClose,
  onOpenExpenses,
  mergeFormOptions,
}: {
  date: string;
  mergeFormOptions: MergeFormOptions;
  entries: JournalEntry[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  onOpenEntry: (id: number) => void;
  onClose: () => void;
  /** Omit to hide the $ button — a reader without the Expense module. */
  onOpenExpenses?: () => void;
}) {
  const router = useRouter();
  /** The row whose Delete was pressed, if the confirmation is open. */
  const [deleting, setDeleting] = useState<JournalEntry | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  // Bulk selection. Ids, not rows: the rows are props that change on every
  // refresh, and `selectedRows` below re-derives from them so an entry that was
  // just deleted drops out of the selection by itself.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The target state, not a toggle — Lock and Unlock are two buttons.
  const [confirmLock, setConfirmLock] = useState<{ isLocked: boolean } | undefined>(undefined);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const selectedRows = entries.filter((entry) => selectedIds.has(entry.id));
  const allSelected = entries.length > 0 && selectedRows.length === entries.length;
  const clearSelection = () => setSelectedIds(new Set());

  // The bulk actions hand back a re-read of a grid's rows for a scope. The
  // calendar has no such grid — its rows are props — so the scope is only the
  // cheapest valid one and the result is ignored in favour of router.refresh().
  const refreshScope = (): BulkRefreshScope => ({ tab: "main", filter: emptyFilter() });

  const merging = useJournalMerge({
    scope: refreshScope,
    applyRows: (_rows, message) => {
      setNotice(message);
      router.refresh();
    },
    setError,
    setNotice,
    setBusy: setIsBulkBusy,
  });

  function toggleEntry(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulkDelete() {
    setIsBulkBusy(true);
    setError(undefined);
    try {
      const result = await deleteJournalEntriesAction(
        selectedRows.map((entry) => entry.id),
        refreshScope(),
      );
      setConfirmDelete(false);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete the selected entries.");
        return;
      }
      clearSelection();
      setNotice(result.message ?? "Entries deleted.");
      router.refresh();
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function runBulkLock(isLocked: boolean) {
    setIsBulkBusy(true);
    setError(undefined);
    try {
      const result = await bulkLockJournalEntriesAction(
        selectedRows.map((entry) => entry.id),
        isLocked,
        refreshScope(),
      );
      setConfirmLock(undefined);
      if (!result.ok) {
        setError(result.error ?? "Failed to update the selected entries.");
        return;
      }
      clearSelection();
      setNotice(result.message ?? "Entries updated.");
      router.refresh();
    } finally {
      setIsBulkBusy(false);
    }
  }

  /**
   * Recycles the entry, then re-reads the period from the server.
   *
   * `router.refresh()` rather than dropping the row from a local copy: this
   * view holds no entry state of its own — the grid cells, the counts in the
   * toolbar and this list are all derived from the `entries` prop — so patching
   * one list would leave the deleted entry's title sitting in its calendar cell.
   */
  async function handleDelete(entry: JournalEntry) {
    setIsDeleting(true);
    setError(undefined);
    try {
      const result = await recycleJournalEntryAction(entry.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleting(undefined);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">
            {formatCalendarDayHeading(date)}
          </h3>
          <p className="text-xs text-muted">
            {entries.length === 0
              ? "No entries on this date."
              : entries.length === 1
                ? "1 entry"
                : `${entries.length} entries`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* The New Entry section, seeded with the day being viewed — `?date=`
              is the same param this calendar reads for the open day, and the
              section hands it to the form as its starting date. Pointing at
              `/modules/journal` instead (which this did) lands on the module
              home screen, which ignores the param. */}
          <Button
            href={`/modules/journal/new-entry?date=${date}`}
            variant="secondary"
            size="sm"
          >
            New entry
          </Button>
          {/* What was spent around this day, as a dialog over the calendar —
              the reader keeps the month they were reading. Icon-only to sit
              beside two text buttons without widening the header on a phone. */}
          {onOpenExpenses && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenExpenses}
              title="Expenses around this date"
              ariaLabel="Expenses around this date"
            >
              <SlotIcon slot={DAY_EXPENSES_SLOT} className="h-4 w-4" />
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose} ariaLabel="Close this day">
            Close
          </Button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {notice && !error && <p className="mt-2 text-sm text-muted">{notice}</p>}

      {entries.length > 0 ? (
        // Select all, and the bulk actions once anything is ticked. Wraps on a
        // phone; the buttons keep the size the rest of this panel uses.
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-muted max-lg:py-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelectedIds(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))
              }
              className="h-4 w-4 accent-brass"
            />
            {selectedRows.length === 0 ? "Select all" : `${selectedRows.length} selected`}
          </label>
          {selectedRows.length > 0 ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBulkBusy || selectedRows.length < 2}
                title={
                  selectedRows.length < 2 ? "Tick two or more entries to merge them" : undefined
                }
                onClick={() => void merging.start(selectedRows, clearSelection)}
              >
                Merge
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBulkBusy}
                onClick={() => setConfirmLock({ isLocked: true })}
              >
                Lock
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBulkBusy}
                onClick={() => setConfirmLock({ isLocked: false })}
              >
                Unlock
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isBulkBusy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
              <Button size="sm" variant="secondary" disabled={isBulkBusy} onClick={clearSelection}>
                Clear
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ul className="mt-1 flex flex-col divide-y divide-line border-t border-line">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              // Zebra striping, and the hover lives here rather than on the
              // inner button so it covers the whole row — the button is only
              // the middle of it, and a partial tint over a stripe reads as a
              // glitch.
              //
              // The stripe is `--paper`, NOT a translucent `--paper-raised`:
              // this panel is itself `bg-paper-raised`, so tinting with that
              // token over itself composites to the panel colour and stripes
              // nothing. `--paper` is its sibling in every theme, so the pair
              // reads in both directions without a light/dark flag.
              className={`flex items-center gap-2 transition-colors ${
                index % 2 === 1 ? "bg-paper" : ""
              } hover:bg-brass-soft`}
            >
              <label className="flex shrink-0 cursor-pointer items-center px-2 py-2 max-lg:px-3 max-lg:py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(entry.id)}
                  onChange={() => toggleEntry(entry.id)}
                  aria-label={`Select the entry ${
                    entry.isEncrypted || entry.title.trim() === "" ? "on this day" : entry.title
                  }`}
                  className="h-4 w-4 accent-brass"
                />
              </label>
              {/* A bare pencil, not a labelled button: a row action, which
                  coding-guide.md keeps out of the icon-slot registry, and
                  ALWAYS_CLASSIC holds it hand-drawn. A link rather than a
                  router push, so it opens in a new tab like any other. */}
              <Link
                href={`/modules/journal/entries/${entry.id}`}
                aria-label={`Edit the entry ${
                  entry.isEncrypted || entry.title.trim() === "" ? "on this day" : entry.title
                }`}
                title="Edit"
                className="shrink-0 px-1 text-muted hover:text-brass max-lg:px-2 max-lg:py-1"
              >
                <TreeIcon name="pencil" className="h-4 w-4" />
              </Link>
              {/* The row's clickable region and Delete are siblings, not nested:
                  a <button> inside a <button> is invalid HTML and the inner one
                  would not reliably receive the click. */}
              <button
                type="button"
                onClick={() => onOpenEntry(entry.id)}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left max-lg:py-3"
              >
                <span className="w-12 shrink-0 font-mono text-xs text-muted">
                  {entry.time === "" ? "—" : entry.time.slice(0, 5)}
                </span>
                {/* Full title here — the elision is a cell constraint, not a
                    property of the entry, so the list shows the whole thing. */}
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    entry.isEncrypted ? "text-muted" : "text-ink"
                  }`}
                >
                  {entry.isEncrypted
                    ? ENCRYPTED_TITLE_PLACEHOLDER
                    : entry.title.trim() === ""
                      ? "(untitled)"
                      : entry.title}
                </span>
                {/* A labelled chip, not a bare padlock: this list is where a reader
                    checks which entries are locked, so it says so in words. A state
                    marker, so no icon slot (coding-guide.md keeps `lock` out of the
                    registry). */}
                {entry.isLocked ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-brass-soft px-1.5 py-0.5 text-xs text-brass-dark">
                    <TreeIcon name="lock" className="h-3 w-3" />
                    Locked
                  </span>
                ) : null}
                {entry.placeName === "" ? null : (
                  <span className="truncate text-xs text-muted max-lg:w-full">
                    {entry.placeName}
                  </span>
                )}
                {/* Labelled chips rather than bare icons, so a glyph the reader
                    doesn't recognise still names itself. Capped at 3 with a
                    `+N`: a chip is much wider than the icon it replaced, and
                    this row already competes with the title and the place name.
                    No `href` — the whole row is a <button>, and a link nested in
                    a button is invalid HTML; the entry it opens carries the
                    full set anyway. */}
                <TaxonomyChipRow
                  className="shrink-0"
                  items={[
                    ...entry.categories.map((name) => ({ name, url: categoryIcons[name] })),
                    ...entry.tags.map((name) => ({ name, url: tagIcons[name] })),
                  ]}
                />
              </button>
              {/* A labelled button, not a bare trash glyph: row actions stay as
                  they are per coding-guide.md, and a word needs no icon slot.
                  Enabled for a locked entry — recycling keeps the lock, unlike
                  the entry screen's hard delete, which refuses one. */}
              <Button
                size="sm"
                variant="danger"
                disabled={isDeleting || isBulkBusy}
                onClick={() => {
                  setError(undefined);
                  setDeleting(entry);
                }}
                ariaLabel={`Delete the entry ${
                  entry.isEncrypted || entry.title.trim() === "" ? "on this day" : entry.title
                }`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <JournalMergeDialogs
        merge={merging.merge}
        cleanup={merging.cleanup}
        formOptions={mergeFormOptions}
        isBusy={isBulkBusy}
        onMergeClose={merging.close}
        onSavingChange={setIsBulkBusy}
        onMergeSaved={(saved) => void merging.handleSaved(saved)}
        onCleanupKeep={merging.keep}
        onCleanupDelete={(sourceIds) => void merging.runCleanup(sourceIds)}
      />

      {confirmDelete && (
        <BulkConfirm
          title="Delete these entries?"
          description="They move to the recycle bin under Data Management, and can be restored from there."
          count={selectedRows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={
            selectedRows.some((entry) => entry.isLocked) ? (
              <>
                Some of these are <span className="text-ink">locked</span>. They move to the bin
                too, still locked — restoring one brings it back locked.
              </>
            ) : undefined
          }
          confirmLabel="Delete"
          isBusy={isBulkBusy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void runBulkDelete()}
        />
      )}

      {confirmLock && (
        <BulkConfirm
          title={confirmLock.isLocked ? "Lock these entries?" : "Unlock these entries?"}
          description={
            confirmLock.isLocked
              ? "A locked entry can't be edited or deleted on its own screen until it is unlocked."
              : "Unlocking makes these entries editable again."
          }
          count={selectedRows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={(() => {
            const unchanged = selectedRows.filter(
              (entry) => entry.isLocked === confirmLock.isLocked,
            ).length;
            if (unchanged === 0) return undefined;
            return (
              <>
                {unchanged === 1 ? "1 is" : `${unchanged} are`} already{" "}
                {confirmLock.isLocked ? "locked" : "unlocked"} and will be left alone.
              </>
            );
          })()}
          confirmLabel={confirmLock.isLocked ? "Lock" : "Unlock"}
          tone="primary"
          isBusy={isBulkBusy}
          onCancel={() => setConfirmLock(undefined)}
          onConfirm={() => void runBulkLock(confirmLock.isLocked)}
        />
      )}

      {deleting && (
        <Modal
          title="Delete this entry?"
          // The title an encrypted entry can't show is replaced by the
          // placeholder: naming the row is the point of this dialog, and a
          // blank description would leave the reader guessing which one.
          description={
            deleting.isEncrypted
              ? ENCRYPTED_TITLE_PLACEHOLDER
              : deleting.title.trim() === ""
                ? "(untitled)"
                : deleting.title
          }
          isBusy={isDeleting}
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setDeleting(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isDeleting}
                onClick={() => void handleDelete(deleting)}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {formatCalendarDayHeading(deleting.date)}
            {deleting.time === "" ? "" : ` at ${deleting.time.slice(0, 5)}`}
          </p>
          <p className="mt-2 text-sm text-muted">
            It moves to the recycle bin and can be restored from Data Management → Recycle
            Bin.
          </p>
          {deleting.isLocked && (
            <p className="mt-2 text-sm text-muted">
              This entry is <span className="text-ink">locked</span>. It moves to the bin with the
              lock intact, so restoring it brings it back locked.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
