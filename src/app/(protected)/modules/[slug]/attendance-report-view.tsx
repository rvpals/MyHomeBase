"use client";

// The printable attendance report: pick a class and a date, print the sheet.
//
// Printing goes through the `print-sheet` / `no-print` classes defined in the
// @media print block in globals.css — no per-view print CSS. See design.md.

import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { AttendanceClass, AttendanceReport } from "@/lib/attendance";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export function AttendanceReportView({
  classes,
  report,
  selectedClassId,
  selectedDate,
  recordedDates,
}: {
  classes: AttendanceClass[];
  /** Undefined when the class/date pair has no saved attendance. */
  report?: AttendanceReport;
  selectedClassId?: number;
  selectedDate: string;
  /** The dates this class has records for, newest first. */
  recordedDates: string[];
}) {
  const router = useRouter();

  // The selection lives in the URL so a report is linkable and survives a
  // refresh — the same reasoning the journal's ?filter= uses.
  function go(nextClassId: number | undefined, nextDate: string) {
    const params = new URLSearchParams();
    if (nextClassId) params.set("classId", String(nextClassId));
    params.set("date", nextDate);
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
          Attendance for {report.attendanceDate} · recorded {report.recordedAt}
        </p>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <StatTile label="Present" value={report.presentCount} />
        <StatTile label="Absent" value={report.absentCount} />
        <StatTile label="Total" value={report.entries.length} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        <NameList title={`Present (${present.length})`} names={present.map((e) => e.studentName)} />
        <NameList title={`Absent (${absent.length})`} names={absent.map((e) => e.studentName)} />
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

function NameList({ title, names }: { title: string; names: string[] }) {
  return (
    <section>
      <h4 className="font-display text-base text-ink">{title}</h4>
      {names.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nobody.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {names.map((name, index) => (
            <li key={`${name}-${index}`} className="border-b border-line py-1 text-sm text-ink">
              {name}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
