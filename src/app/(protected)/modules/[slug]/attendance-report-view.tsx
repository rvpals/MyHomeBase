"use client";

// The printable attendance report: pick a class and a date, print the sheet.
//
// Printing goes through the `print-sheet` / `no-print` classes defined in the
// @media print block in globals.css — no per-view print CSS. See design.md.

import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import {
  attendanceDetailReportToCsv,
  attendanceReportCsvFileName,
  attendanceReportToCsv,
} from "@/lib/attendance";
import type {
  AttendanceClass,
  AttendanceDetailReport,
  AttendanceDetailRow,
  AttendanceEntry,
  AttendanceReport,
  AttendanceReportFormat,
  AttendanceSessionSummary,
} from "@/lib/attendance";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export function AttendanceReportView({
  classes,
  format,
  report,
  detailReport,
  selectedClassId,
  selectedDate,
  recordedDates,
  sessionsOnDate,
}: {
  classes: AttendanceClass[];
  /** Which shape to render. The date/session pickers only apply to "brief". */
  format: AttendanceReportFormat;
  /** Undefined when the class/date pair has no saved attendance, or on "detail". */
  report?: AttendanceReport;
  /** The whole-term grid. Only loaded for the "detail" format. */
  detailReport?: AttendanceDetailReport;
  selectedClassId?: number;
  selectedDate: string;
  /** The dates this class has records for, newest first. */
  recordedDates: string[];
  /**
   * The sessions on the selected date, newest first. More than one when the
   * class was registered again the same day.
   */
  sessionsOnDate: AttendanceSessionSummary[];
}) {
  const router = useRouter();

  // The selection lives in the URL so a report is linkable and survives a
  // refresh — the same reasoning the journal's ?filter= uses.
  function go(
    nextClassId: number | undefined,
    nextDate: string,
    nextRecordId?: number,
    nextFormat: AttendanceReportFormat = format,
  ) {
    const params = new URLSearchParams();
    if (nextClassId) params.set("classId", String(nextClassId));
    params.set("date", nextDate);
    if (nextRecordId) params.set("recordId", String(nextRecordId));
    // Omitted when brief so the default shape keeps a clean, shareable URL —
    // ?format=brief and no param at all mean the same thing.
    if (nextFormat !== "brief") params.set("format", nextFormat);
    router.push(`/modules/attendance/report?${params.toString()}`);
  }

  /**
   * Downloads what is on screen. Which report is loaded already encodes the
   * format, so this follows the render rather than re-reading `format` — the
   * two can't disagree that way.
   */
  function handleExport() {
    const file = detailReport
      ? {
          csv: attendanceDetailReportToCsv(detailReport),
          name: attendanceReportCsvFileName(detailReport.className),
        }
      : report
        ? {
            csv: attendanceReportToCsv(report),
            name: attendanceReportCsvFileName(report.className, report.attendanceDate),
          }
        : undefined;
    if (!file) return;

    // Same blob-and-anchor download DataGrid's Export CSV uses.
    const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file.name}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Class</span>
          <select
            value={selectedClassId ?? ""}
            onChange={(event) =>
              go(event.target.value ? Number(event.target.value) : undefined, selectedDate)
            }
            className={INPUT_CLASS}
          >
            <option value="">Pick a class…</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Format</span>
          <select
            value={format}
            onChange={(event) =>
              go(
                selectedClassId,
                selectedDate,
                undefined,
                event.target.value as AttendanceReportFormat,
              )
            }
            className={INPUT_CLASS}
          >
            <option value="brief">Brief</option>
            <option value="detail">Detail</option>
          </select>
        </label>

        {/* The date, session and jump-to pickers belong to the brief sheet: the
            detail grid spans every recorded date, so narrowing to one would
            leave it with a single column. */}
        {format === "brief" && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => go(selectedClassId, event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}

        {/* Only shown when the day actually holds more than one register —
            a picker with a single option is noise. */}
        {format === "brief" && sessionsOnDate.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Session</span>
            <select
              value={report?.recordId ?? ""}
              onChange={(event) =>
                go(selectedClassId, selectedDate, Number(event.target.value) || undefined)
              }
              className={INPUT_CLASS}
            >
              {sessionsOnDate.map((session, index) => (
                <option key={session.recordId} value={session.recordId}>
                  {session.sessionLabel}
                  {index === 0 ? " (latest)" : ""} · {session.presentCount}/
                  {session.presentCount + session.absentCount} present
                </option>
              ))}
            </select>
          </label>
        )}

        {format === "brief" && recordedDates.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Days with attendance</span>
            <select
              value={recordedDates.includes(selectedDate) ? selectedDate : ""}
              onChange={(event) => event.target.value && go(selectedClassId, event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Jump to…</option>
              {recordedDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
        )}

        {(report ?? detailReport) && (
          <>
            <Button onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" onClick={handleExport}>
              Export CSV
            </Button>
          </>
        )}
      </div>

      {!selectedClassId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          Pick a class to see its report.
        </p>
      ) : format === "detail" ? (
        !detailReport || detailReport.dates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
            No attendance has been taken for this class yet.
          </p>
        ) : (
          <DetailSheet report={detailReport} />
        )
      ) : !report ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No attendance was taken for this class on {selectedDate}.
        </p>
      ) : (
        <ReportSheet report={report} />
      )}
    </div>
  );
}

function ReportSheet({ report }: { report: AttendanceReport }) {
  const present = report.entries.filter((entry) => entry.status === "present");
  const absent = report.entries.filter((entry) => entry.status === "absent");

  return (
    <div className="print-sheet rounded-xl border border-line p-6">
      <header>
        <h3 className="font-display text-2xl text-ink">{report.className}</h3>
        <p className="mt-1 text-sm text-muted">
          Attendance for {report.attendanceDate}
          {report.sessionLabel && ` · session ${report.sessionLabel}`} · recorded{" "}
          {report.recordedAt}
        </p>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <StatTile label="Present" value={report.presentCount} />
        <StatTile label="Absent" value={report.absentCount} />
        <StatTile label="Total" value={report.entries.length} />
      </div>

      {/* Only when the session recorded something. A row of zeroes for every
          action the catalog holds would be noise on a printed sheet, and would
          grow every time a teacher added one. */}
      {report.actionTallies.length > 0 && (
        <div className="mt-4">
          <h4 className="font-display text-base text-ink">Actions noted</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {report.actionTallies.map((tally) => (
              <span
                key={tally.actionId}
                className="rounded-md border border-line px-2 py-1 text-sm text-ink"
                title={tally.name}
              >
                <span className="font-mono font-semibold text-brass-dark">{tally.code}</span>{" "}
                {tally.name} · {tally.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card-grid mt-6 gap-6">
        <NameList title={`Present (${present.length})`} entries={present} />
        <NameList title={`Absent (${absent.length})`} entries={absent} />
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-xl text-ink">{value}</p>
    </div>
  );
}

/**
 * One column of names, each with whatever was noted about them.
 *
 * Takes the entries rather than the names now: the codes hang off the same row,
 * and passing two parallel arrays would let them fall out of step. The code chips
 * are text rather than glyphs — this sheet is printed, often in black and white,
 * and a two-letter code survives that where a 12px icon does not.
 */
function NameList({ title, entries }: { title: string; entries: AttendanceEntry[] }) {
  return (
    <section>
      <h4 className="font-display text-base text-ink">{title}</h4>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nobody.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {entries.map((entry, index) => (
            <li
              key={`${entry.studentId}-${index}`}
              className="flex items-center justify-between gap-2 border-b border-line py-1 text-sm text-ink"
            >
              <span className="min-w-0 truncate">{entry.studentName}</span>
              {entry.actions.length > 0 && (
                <span className="flex shrink-0 gap-1">
                  {entry.actions.map((action) => (
                    <span
                      key={action.actionId}
                      title={action.name}
                      className="rounded bg-brass-soft px-1.5 font-mono text-[11px] font-semibold text-brass-dark"
                    >
                      {action.code}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Shortens an ISO date for a column header: `2026-08-25` -> `8/25`.
 *
 * Hand-sliced rather than `toLocaleDateString`, which would need a Date and
 * therefore a timezone -- and an attendance date is a calendar day, not an
 * instant, so constructing one is how a date drifts by one. The year is dropped
 * because a column per day already runs wide; it stays in the row heading and
 * the tooltip.
 */
function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (month === undefined || day === undefined) return isoDate;
  return `${Number(month)}/${Number(day)}`;
}

/**
 * The whole-term grid: a row per student, a column per date.
 *
 * NARROW SCREENS: the table cannot reflow -- a term is genuinely wider than a
 * phone -- so it scrolls horizontally inside its own container with the name
 * column pinned left via `sticky`. That keeps the thing you need to read a row
 * (whose row it is) on screen while the dates move under it, which is what makes
 * the grid usable at any width without a second component.
 */
function DetailSheet({ report }: { report: AttendanceDetailReport }) {
  return (
    <div className="print-sheet rounded-xl border border-line p-6 max-lg:p-4">
      <header>
        <h3 className="font-display text-2xl text-ink">{report.className}</h3>
        <p className="mt-1 text-sm text-muted">
          Attendance across {report.dates.length}{" "}
          {report.dates.length === 1 ? "day" : "days"} · {report.rows.length}{" "}
          {report.rows.length === 1 ? "student" : "students"}
          {report.dates.length > 0 && ` · ${report.dates[0]} to ${report.dates[report.dates.length - 1]}`}
        </p>
      </header>

      {/* `-mx-*` lets the scroll area reach the card's edges, so a wide grid uses
          the full width rather than scrolling inside a padded box. */}
      <div className="mt-4 -mx-6 overflow-x-auto max-lg:-mx-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {/* `left-0` pairs with the body cells below; both need the same
                  offset or the pinned column and its header separate. */}
              <th className="sticky left-0 z-10 bg-paper px-6 py-2 text-left align-bottom font-medium text-muted max-lg:px-4">
                Student
              </th>
              {report.dates.map((date) => (
                <th
                  key={date}
                  title={date}
                  scope="col"
                  className="whitespace-nowrap px-2 py-2 text-center font-mono text-xs font-medium text-muted"
                >
                  {shortDate(date)}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-muted">
                P / A
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <DetailRow key={row.studentId} row={row} dates={report.dates} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted">
        <span className="font-mono font-semibold text-ink">P</span> present ·{" "}
        <span className="font-mono font-semibold text-ink">A</span> absent ·{" "}
        <span className="font-mono text-muted">&mdash;</span> not enrolled that day.
        Any further codes are the actions noted that day; a day registered more than
        once shows its latest session.
      </p>
    </div>
  );
}

function DetailRow({ row, dates }: { row: AttendanceDetailRow; dates: string[] }) {
  return (
    <tr className="border-b border-line">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-paper px-6 py-1.5 text-left font-normal text-ink max-lg:px-4"
      >
        <span className="block max-w-[12rem] truncate">{row.studentName}</span>
      </th>

      {row.cells.map((cell, index) => (
        <td
          key={dates[index]}
          className="whitespace-nowrap px-2 py-1.5 text-center align-middle"
        >
          {cell.status === undefined ? (
            // Not enrolled that day. Deliberately not an A -- see
            // AttendanceDetailCell.
            <span className="text-muted" title="Not enrolled on this date">
              &mdash;
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1">
              {/* A letter, not a colored dot: this sheet gets printed, often in
                  black and white, where a tint carries nothing. */}
              <span
                className={`font-mono text-xs font-semibold ${
                  cell.status === "present" ? "text-ink" : "text-red-400"
                }`}
              >
                {cell.status === "present" ? "P" : "A"}
              </span>
              {cell.actions.map((action) => (
                <span
                  key={action.actionId}
                  title={action.name}
                  className="rounded bg-brass-soft px-1 font-mono text-[10px] font-semibold text-brass-dark"
                >
                  {action.code}
                </span>
              ))}
            </span>
          )}
        </td>
      ))}

      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-muted">
        {row.presentCount} / {row.absentCount}
      </td>
    </tr>
  );
}
