"use client";

// Taking attendance: pick a class, tap the students who are here, save.
//
// The tap-to-toggle list is one-off UI for this screen rather than a registered
// component — nothing else in the app marks a list of people present. If a
// second caller appears, that's the moment to promote it.

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import type { AttendanceSheet, AttendanceStatus, Student } from "@/lib/attendance";
import { saveAttendanceAction } from "./attendance-actions";

const SELECT_CLASS = "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** A student's display name. Mirrors `formatStudentName` in the lib. */
function studentName(student: Student): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

export function AttendanceHomeView({
  classes,
  sheet,
  selectedClassId,
  today,
}: {
  classes: { id: number; name: string; enrolledCount: number }[];
  /** The chosen class's roster, or undefined when no class is selected. */
  sheet?: AttendanceSheet;
  selectedClassId?: number;
  /** Today, as the server's local calendar day. */
  today: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ClassPicker classes={classes} selectedClassId={selectedClassId} />
      {sheet ? (
        <AttendanceSheetForm key={`${sheet.classId}:${sheet.attendanceDate}`} sheet={sheet} today={today} />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          {classes.length === 0
            ? "No classes yet — create one on the Classes screen first."
            : "Pick a class above to start taking attendance."}
        </p>
      )}
    </div>
  );
}

/**
 * The class selector.
 *
 * A plain link-per-class rather than a `<select>` with an onChange router push:
 * the selection is in the URL, so a teacher can bookmark their first-period
 * class and land straight on its register.
 */
function ClassPicker({
  classes,
  selectedClassId,
}: {
  classes: { id: number; name: string; enrolledCount: number }[];
  selectedClassId?: number;
}) {
  if (classes.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Class</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {classes.map((item) => {
          const isSelected = item.id === selectedClassId;
          return (
            <Button
              key={item.id}
              href={`/modules/attendance?classId=${item.id}`}
              size="sm"
              variant={isSelected ? "primary" : "secondary"}
            >
              {item.name}
              <span className="ml-2 opacity-70">{item.enrolledCount}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function AttendanceSheetForm({ sheet, today }: { sheet: AttendanceSheet; today: string }) {
  // Everyone starts absent, so a save always accounts for every enrolled
  // student. When the day already has a record we start from what was saved,
  // which is what makes re-taking attendance a correction rather than a restart.
  const initialPresent = useMemo(() => {
    const present = new Set<number>();
    for (const entry of sheet.existingRecord?.entries ?? []) {
      if (entry.status === "present") present.add(entry.studentId);
    }
    return present;
  }, [sheet.existingRecord]);

  const [presentIds, setPresentIds] = useState<Set<number>>(initialPresent);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function toggle(studentId: number) {
    setPresentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
    setMessage(undefined);
  }

  function handleSave() {
    setError(undefined);
    setMessage(undefined);

    const entries = sheet.students.map((student) => ({
      studentId: student.id,
      status: (presentIds.has(student.id) ? "present" : "absent") as AttendanceStatus,
    }));

    startTransition(async () => {
      const result = await saveAttendanceAction({
        classId: sheet.classId,
        attendanceDate: sheet.attendanceDate,
        entries,
      });

      if (result.ok) {
        setMessage(
          `Saved ${presentIds.size} present and ${entries.length - presentIds.size} absent for ${sheet.className}.`,
        );
      } else {
        setError(result.error);
      }
    });
  }

  if (sheet.students.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
        {sheet.className} has no students yet — add some from the Rosters screen.
      </p>
    );
  }

  const isPastDay = sheet.attendanceDate !== today;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-xl text-ink">{sheet.className}</h3>
        <span className="rounded-md bg-brass-soft px-2 py-0.5 font-mono text-xs text-brass-dark">
          {sheet.attendanceDate}
        </span>
        <Comments
          title="Taking attendance"
          content="Everyone starts absent. Tap a student to mark them present, then press Save. Saving again for the same class on the same day replaces that day's record."
        />
        <span className="flex-1" />
        <p className="text-sm text-muted">
          {presentIds.size} of {sheet.students.length} present
        </p>
      </div>

      {sheet.existingRecord && (
        <p className="rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-muted">
          Attendance was already taken for this day. Saving will replace it.
        </p>
      )}

      {isPastDay && (
        <p className="rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-muted">
          This is {sheet.attendanceDate}, not today.
        </p>
      )}

      {/* One column on a phone (a tap-target list is already the right shape
          there), two once there's room. Not a DataGrid: this is a set of large
          buttons, not a table of records. */}
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {sheet.students.map((student) => {
          const isPresent = presentIds.has(student.id);
          return (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => toggle(student.id)}
                aria-pressed={isPresent}
                disabled={isPending}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                  isPresent
                    ? "border-brass bg-brass-soft text-ink"
                    : "border-line bg-paper-raised text-muted hover:border-brass"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base text-ink">{studentName(student)}</span>
                  {student.studentIdentifier && (
                    <span className="block truncate font-mono text-xs text-muted">
                      {student.studentIdentifier}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wide ${
                    isPresent ? "bg-brass text-paper" : "text-muted"
                  }`}
                >
                  {isPresent ? "Present" : "Absent"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save attendance"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setPresentIds(new Set(sheet.students.map((student) => student.id)))}
          disabled={isPending}
        >
          Mark all present
        </Button>
        <Button variant="secondary" onClick={() => setPresentIds(new Set())} disabled={isPending}>
          Clear
        </Button>
        {message && <p className="text-sm text-emerald-400">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
