"use client";

// The Individual Student Record: one student's attendance, one class section
// after another.
//
// Rendered inside the Rosters modal, not on a route of its own — it is opened
// from a roster row and read against that list, so a navigation away and back
// would cost the teacher their place in the grid.

import { CLASS_WEEKDAY_LABELS, type ClassWeekday } from "@/lib/attendance";
import type { IndividualStudentRecord, StudentClassRecord } from "@/lib/attendance";

export function AttendanceStudentRecordView({ record }: { record: IndividualStudentRecord }) {
  const { student, classes, presentCount, absentCount } = record;
  const totalDays = presentCount + absentCount;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">
          {student.firstName} {student.lastName}
        </h3>
        <p className="text-xs text-muted">
          {student.studentIdentifier ? `ID ${student.studentIdentifier} · ` : ""}
          {classes.length === 1 ? "1 class" : `${classes.length} classes`}
          {totalDays > 0 && ` · ${presentCount} of ${totalDays} days present`}
        </p>
      </header>

      {classes.length === 0 ? (
        <p className="text-sm text-muted">Not enrolled in any class.</p>
      ) : (
        classes.map((classRecord) => (
          <ClassSection key={classRecord.classId} record={classRecord} />
        ))
      )}
    </div>
  );
}

/** One class's block: its heading, its totals, then every day in it. */
function ClassSection({ record }: { record: StudentClassRecord }) {
  const weekday = CLASS_WEEKDAY_LABELS[record.classWeekday as ClassWeekday];

  return (
    <section className="rounded-md border border-line">
      {/* Wraps to two lines narrow rather than squeezing the totals onto the
          title's line — the class name is the longest thing here. */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h4 className="text-sm font-semibold text-ink">
          {record.className}
          {weekday && <span className="ml-2 text-xs font-normal text-muted">{weekday}</span>}
        </h4>
        <p className="text-xs text-muted">
          {record.attendanceRate === undefined
            ? "No attendance recorded yet"
            : `${record.presentCount} present · ${record.absentCount} absent · ${Math.round(
                record.attendanceRate * 100,
              )}%`}
        </p>
      </header>

      {record.days.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">No sessions recorded for this student.</p>
      ) : (
        <ul className="divide-y divide-line">
          {record.days.map((day) => (
            <li
              key={day.attendanceDate}
              // Stacks narrow, one line wide: the three parts are short enough
              // to sit side by side on a desktop but would wrap mid-value on a
              // phone. A restyle, not a different component — see design.md.
              className="flex flex-col gap-0.5 px-3 py-2 text-sm max-lg:items-start lg:flex-row lg:items-baseline lg:justify-between lg:gap-3"
            >
              <span className="font-mono text-xs text-muted">
                {day.attendanceDate}
                {day.sessionLabel && ` · ${day.sessionLabel}`}
              </span>

              <span className="flex flex-wrap items-baseline gap-2">
                {day.actions.map((action) => (
                  // Codes, not names: the same short form the printed report
                  // uses, so the two read alike. `title` carries the full name
                  // for anyone who doesn't know the code.
                  <span
                    key={action.actionId}
                    title={action.name}
                    className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted"
                  >
                    {action.code}
                  </span>
                ))}
                <span
                  className={
                    day.status === "present" ? "text-ink" : "font-medium text-red-400"
                  }
                >
                  {day.status === "present" ? "Present" : "Absent"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
