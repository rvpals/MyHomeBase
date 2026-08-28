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

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { JournalViewer } from "@/components/journal-viewer";
import { Modal } from "@/components/modal";
import { PhotoOfTheDayButton } from "@/components/photo-of-the-day";
import { useIsCompact } from "@/components/viewport-context";
import {
  CALENDAR_CELL_TITLE_LIMIT,
  CALENDAR_CELL_TITLE_LIMIT_COMPACT,
  DEFAULT_JOURNAL_DATE_FORMAT,
  JOURNAL_DATE_FORMATS,
  WEEKDAY_LABELS,
  buildMonthGrid,
  buildWeekGrid,
  buildYearGrid,
  endOfMonth,
  formatCalendarDayHeading,
  formatJumpDate,
  isJournalDateFormat,
  parseJumpDate,
  shiftCalendarAnchor,
  startOfMonth,
  type CalendarDay,
  type CalendarWeek,
  type JournalCalendarScope,
  type JournalDateFormat,
  type JournalEntry,
} from "@/lib/journal";
import { JournalPhotosHost } from "./journal-photos-host";
import { journalEntriesFilterHref, TaxonomyIconThumbnail } from "./journal-shared";

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
}

export function JournalCalendarView({
  scope,
  anchor,
  today,
  selectedDate,
  entries,
  categoryIcons,
  tagIcons,
}: JournalCalendarViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCompact = useIsCompact();

  /** Which entry the viewer dialog is showing, if any. */
  const [openEntryId, setOpenEntryId] = useState<number | undefined>(undefined);
  /** Which photos the Photo of the Day dialog is showing, if it is open. */
  const [photoRequest, setPhotoRequest] = useState<PhotoRequest | undefined>(undefined);

  // The three grids come straight from the library; this component never walks a
  // calendar itself. Memoized because the year scope builds 12 × 42 cells and the
  // inputs only change on a navigation.
  const monthOrWeekGrid = useMemo(
    () =>
      scope === "week"
        ? buildWeekGrid({ anchor, entries, today, selectedDate })
        : scope === "month"
          ? buildMonthGrid({ anchor, entries, today, selectedDate })
          : undefined,
    [scope, anchor, entries, today, selectedDate],
  );
  const yearGrid = useMemo(
    () =>
      scope === "year" ? buildYearGrid({ anchor, entries, today, selectedDate }) : undefined,
    [scope, anchor, entries, today, selectedDate],
  );

  const title = monthOrWeekGrid?.title ?? yearGrid?.title ?? "";
  const entryCount = monthOrWeekGrid?.entryCount ?? yearGrid?.entryCount ?? 0;

  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
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

  const cellTitleLimit = isCompact ? CALENDAR_CELL_TITLE_LIMIT_COMPACT : CALENDAR_CELL_TITLE_LIMIT;
  const openEntry = openEntryId === undefined ? undefined : entriesById.get(openEntryId);

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
      />

      {monthOrWeekGrid ? (
        <MonthGrid
          weeks={monthOrWeekGrid.weeks}
          cellTitleLimit={cellTitleLimit}
          isWeekScope={scope === "week"}
          onSelectDay={selectDay}
          onOpenEntry={setOpenEntryId}
          onOpenPhotos={(date) => setPhotoRequest({ kind: "day", date })}
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
              onSelectDay={selectDay}
              onOpenMonth={() => navigate({ scope: "month", anchor: `${month.year}-${String(month.month).padStart(2, "0")}-01` })}
            />
          ))}
        </div>
      ) : null}

      {selectedDate ? (
        <DayEntriesPanel
          date={selectedDate}
          entries={selectedEntries}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          onOpenEntry={setOpenEntryId}
          onClose={() => navigate({ date: null })}
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

      {openEntry ? (
        <Modal
          title={openEntry.title.trim() === "" ? "Journal entry" : openEntry.title}
          size="lg"
          onClose={() => setOpenEntryId(undefined)}
          footer={
            <Button href={`/modules/journal/entries/${openEntry.id}`} variant="secondary" size="sm">
              Open full entry
            </Button>
          }
        >
          {/* The registered viewer, not a re-implementation. Read-only here: the
              calendar is for finding an entry, and editing it belongs on the
              entry screen, which the footer link goes to. */}
          <JournalViewer
            entry={openEntry}
            categoryIcons={categoryIcons}
            tagIcons={tagIcons}
            categoryHref={(name) => journalEntriesFilterHref("category", name)}
            tagHref={(name) => journalEntriesFilterHref("tag", name)}
          />
        </Modal>
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
}) {
  const stepLabel = scope === "week" ? "week" : scope === "year" ? "year" : "month";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ScopeSwitch scope={scope} onScope={onScope} />
        <Button variant="secondary" size="sm" onClick={onToday}>
          Today
        </Button>
        <JumpControl anchor={anchor} today={today} onJump={onJump} />
        <Comments
          title="Using the calendar"
          content={
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                Each day shows its entry titles, cut to the first 30 characters — hover a
                title for the whole thing.
              </li>
              <li>Click a day to list its entries below the grid; click it again to close.</li>
              <li>Click a title to read the entry without leaving the calendar.</li>
              <li>
                Week, Month and Year are the three ranges; ‹ and › step by whichever one is
                showing.
              </li>
              <li>
                The jump button takes a typed date — pick the format it should be read in, or
                use the picker.
              </li>
              <li>In the year view a darker square means a busier day.</li>
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
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
  ];
  return (
    // A segmented control rather than three Buttons: these are one setting's
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
          className={`px-3 py-1.5 text-sm transition-colors max-lg:px-4 max-lg:py-2 ${
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
          className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-paper-raised p-4 card-raised max-lg:fixed max-lg:inset-x-3 max-lg:right-auto max-lg:w-auto"
        >
          <label
            htmlFor="journal-jump-date"
            className="block text-xs font-medium uppercase tracking-wide text-muted"
          >
            Jump to date
          </label>
          <div className="mt-2 flex gap-2">
            <input
              // Focus and select on mount, through the ref callback rather than
              // an effect: the popover only renders while open, so "mounted" and
              // "just opened" are the same moment.
              ref={(node) => {
                inputRef.current = node;
                node?.select();
              }}
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

// --- Month / week grid -------------------------------------------------------

function MonthGrid({
  weeks,
  cellTitleLimit,
  isWeekScope,
  onSelectDay,
  onOpenEntry,
  onOpenPhotos,
}: {
  weeks: CalendarWeek[];
  cellTitleLimit: number;
  isWeekScope: boolean;
  onSelectDay: (day: CalendarDay) => void;
  onOpenEntry: (id: number) => void;
  onOpenPhotos: (date: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-paper-raised">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted"
          >
            {/* One letter narrow: seven three-letter labels don't fit a phone. */}
            <span className="max-lg:hidden">{label}</span>
            <span className="lg:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flatMap((week) =>
          week.days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              titleLimit={cellTitleLimit}
              isTall={isWeekScope}
              onSelect={() => onSelectDay(day)}
              onOpenEntry={onOpenEntry}
              onOpenPhotos={() => onOpenPhotos(day.date)}
            />
          )),
        )}
      </div>
    </div>
  );
}

function DayCell({
  day,
  titleLimit,
  isTall,
  onSelect,
  onOpenEntry,
  onOpenPhotos,
}: {
  day: CalendarDay;
  titleLimit: number;
  isTall: boolean;
  onSelect: () => void;
  onOpenEntry: (id: number) => void;
  onOpenPhotos: () => void;
}) {
  const shown = day.entries.slice(0, titleLimit);
  const hidden = day.entries.length - shown.length;

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
      className={`flex cursor-pointer flex-col gap-1 border-b border-r border-line p-1.5 text-left transition-colors last:border-r-0 ${
        isTall ? "min-h-40" : "min-h-24 max-lg:min-h-16"
      } ${day.isCurrentPeriod ? "bg-paper" : "bg-paper-raised/40"} ${
        day.isSelected ? "ring-2 ring-inset ring-brass" : "hover:bg-paper-raised"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
            day.isToday
              ? // Today is a filled accent pip — the one thing on the grid that
                // must be findable without reading any numbers.
                "bg-brass text-paper"
              : day.isCurrentPeriod
                ? "text-ink"
                : "text-muted"
          }`}
        >
          {day.dayOfMonth}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {day.entries.length > 0 ? (
            <span className="rounded bg-brass-soft px-1 text-[10px] font-medium text-brass-dark">
              {day.entries.length}
            </span>
          ) : null}
          {/* On EVERY day, not only days with an entry: the archive is filed by date
              independently of the journal, so a day with nothing written can still have
              photographs — which is often exactly why you go looking.

              It stays visible on a phone rather than being revealed on hover, since a
              touch screen has no hover and this is the only way to reach the photos
              there. The narrow cell is 16 units tall, so the button shrinks instead. */}
          <PhotoOfTheDayButton
            hint={`Photos from ${day.date}`}
            onOpen={onOpenPhotos}
            className="max-lg:h-5 max-lg:w-5"
          />
        </span>
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
            className="truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight text-ink hover:bg-brass-soft hover:text-brass-dark"
          >
            {entry.time === "" ? "" : <span className="text-muted">{entry.time.slice(0, 5)} </span>}
            {entry.shortTitle}
          </button>
        ))}
        {hidden > 0 ? (
          <span className="px-1 text-[10px] text-muted">+{hidden} more</span>
        ) : null}
      </div>
    </div>
  );
}

// --- Year grid ---------------------------------------------------------------

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
  // Four steps of shade, scaled to the busiest day of the year rather than a
  // fixed count — a fixed scale washes out a quiet year and saturates a busy one.
  // maxDayEntryCount is 0 for an empty year, so the divisor is guarded.
  const count = day.entries.length;
  const intensity =
    count === 0 || maxDayEntryCount === 0 ? 0 : Math.ceil((count / maxDayEntryCount) * 4);
  const shade =
    intensity === 0
      ? "bg-paper"
      : intensity === 1
        ? "bg-brass-soft"
        : intensity === 2
          ? "bg-brass/40"
          : intensity === 3
            ? "bg-brass/70"
            : "bg-brass";

  // The tooltip carries what the cell is too small to print: the date and every
  // title on it, full length. This is the year view's answer to "hover shows the
  // complete title".
  const hint =
    count === 0
      ? day.date
      : `${day.date}\n${day.entries.map((entry) => (entry.time === "" ? entry.title : `${entry.time.slice(0, 5)} ${entry.title}`)).join("\n")}`;

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
}: {
  date: string;
  entries: JournalEntry[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  onOpenEntry: (id: number) => void;
  onClose: () => void;
}) {
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
          <Button href={`/modules/journal?date=${date}`} variant="secondary" size="sm">
            New entry
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose} ariaLabel="Close this day">
            Close
          </Button>
        </div>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onOpenEntry(entry.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left hover:bg-paper max-lg:py-3"
              >
                <span className="w-12 shrink-0 font-mono text-xs text-muted">
                  {entry.time === "" ? "—" : entry.time.slice(0, 5)}
                </span>
                {/* Full title here — the elision is a cell constraint, not a
                    property of the entry, so the list shows the whole thing. */}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {entry.title.trim() === "" ? "(untitled)" : entry.title}
                </span>
                {entry.placeName === "" ? null : (
                  <span className="truncate text-xs text-muted max-lg:w-full">
                    {entry.placeName}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  {entry.categories.map((name) => (
                    <TaxonomyIconThumbnail key={name} name={name} url={categoryIcons[name]} />
                  ))}
                  {entry.tags.map((name) => (
                    <TaxonomyIconThumbnail key={name} name={name} url={tagIcons[name]} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
