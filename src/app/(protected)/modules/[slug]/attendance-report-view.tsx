"use client";

// The printable attendance report: pick a class and a date, print the sheet.
//
// Printing goes through the `print-sheet` / `no-print` classes defined in the
// @media print block in globals.css — no per-view print CSS. See design.md.

import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type {
  AttendanceClass,
  AttendanceEntry,
  AttendanceReport,
  AttendanceSessionSummary,
} from "@/lib/attendance";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export function AttendanceReportView({
  classes,
  report,
  selectedClassId,
  selectedDate,
  recordedDates,
  sessionsOnDate,
}: {
  classes: AttendanceClass[];
  /** Undefined when the class/date pair has no saved attendance. */
  report?: AttendanceReport;
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
  ) {
    const params = new URLSearchParams();
    if (nextClassId) params.set("classId", String(nextClassId));
    params.set("date", nextDate);
    if (nextRecordId) params.set("recordId", String(nextRecordId));
    router.push(`/modules/attendance/report?${params.toString()}`);
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
          <span className={LABEL_CLASS}>Date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => go(selectedClassId, event.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        {/* Only shown when the day actually holds more than one register —
            a picker with a single option is noise. */}
        {sessionsOnDate.length > 1 && (
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

        {recordedDates.length > 0 && (
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

        {report && <Button onClick={() => window.print()}>Print</Button>}
      </div>

      {!selectedClassId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          Pick a class to see its report.
        </p>
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
