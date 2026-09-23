"use client";

// Correcting days already taken: pick a class, see every register it has, edit
// one of them — or select several and delete them.
//
// **Editing adds no write path.** `saveAttendance` has updated a day's record in
// place since migration 0092 — re-registering a class corrects the day rather
// than adding to it — and `RegisterPanel` has always seeded itself from the
// saved marks. What was missing was only a way to *reach* a date other than
// today: the home screen hardcodes `todayIsoLocal()`.
//
// **Deleting is a genuinely new capability**, and the only one in the module
// that can destroy a saved register. It is deliberately not the same act as
// editing a day to all-absent: "nobody came" is a register, "this class never
// met" is the absence of one, and the detail grid draws those differently (see
// `AttendanceDetailCell.status`). Hence a separate use-case, and a confirm that
// reads the count back before anything goes.
//
// Taking a *new* day is still the home screen's job. This screen only ever
// offers days that already have a register, because on a corrections screen an
// arbitrary date is nearly always a typo, and silently creating a register for
// it is the one outcome this screen should not have.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  CLASS_WEEKDAY_LABELS,
  type AttendanceSessionSummary,
  type AttendanceSheet,
  type ClassWeekday,
  type StudentAction,
} from "@/lib/attendance";
import { describeDayOffset } from "@/lib/shared/date";
import { deleteAttendanceRecordsAction } from "./attendance-actions";
import { RegisterPanel } from "./attendance-home-view";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

const EMPTY_CLASS =
  "rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted";

/** A class's weekday for the picker, or "" when it has none. Mirrors the home view. */
function weekdayLabel(classWeekday: number): string {
  return CLASS_WEEKDAY_LABELS[classWeekday as ClassWeekday] ?? "";
}

export function AttendanceEditView({
  classes,
  sessions,
  sheet,
  actions,
  selectedClassId,
  selectedDate,
  today,
  cardsUseLastNameFirst,
}: {
  classes: { id: number; name: string; classWeekday: number; enrolledCount: number }[];
  /** Every register the chosen class has, newest first. Empty is a valid state. */
  sessions: AttendanceSessionSummary[];
  /** The chosen class and date's roster, or undefined when nothing is being edited. */
  sheet?: AttendanceSheet;
  /** The pickable actions, in catalog order. Empty is a valid state. */
  actions: StudentAction[];
  selectedClassId?: number;
  /** The day being edited, or undefined when the list is just being browsed. */
  selectedDate?: string;
  /** Today, as the server's local calendar day. */
  today: string;
  /** Whether the **card** view reads "Chen, Ava". The list view never does. */
  cardsUseLastNameFirst: boolean;
}) {
  const router = useRouter();

  // The selection lives in the URL, so a half-finished correction survives a
  // refresh and a particular day is linkable — the same reasoning the Report
  // screen's ?classId=/?date= pair uses, and the same two parameter names.
  function go(nextClassId: number | undefined, nextDate?: string) {
    const params = new URLSearchParams();
    if (nextClassId) params.set("classId", String(nextClassId));
    if (nextDate) params.set("date", nextDate);
    const query = params.toString();
    router.push(`/modules/attendance/edit${query ? `?${query}` : ""}`);
  }

  const columns: DataGridColumn<AttendanceSessionSummary>[] = [
    {
      key: "attendanceDate",
      header: "Date",
      value: (row) => row.attendanceDate,
      render: (row) => <span className="font-mono text-xs">{row.attendanceDate}</span>,
    },
    {
      key: "when",
      header: "When",
      // Sorts on the date rather than on the words, so "3 days ago" and
      // "in 4 days" order chronologically instead of alphabetically.
      value: (row) => row.attendanceDate,
      render: (row) => describeDayOffset(row.attendanceDate, today),
    },
    {
      key: "sessionLabel",
      header: "Saved at",
      value: (row) => row.sessionLabel,
      render: (row) => <span className="font-mono text-xs">{row.sessionLabel || "—"}</span>,
    },
    {
      key: "presentCount",
      header: "Present",
      value: (row) => row.presentCount,
      render: (row) => row.presentCount,
    },
    {
      key: "absentCount",
      header: "Absent",
      value: (row) => row.absentCount,
      render: (row) => row.absentCount,
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (row) => (
        <button
          type="button"
          className="text-brass-dark hover:underline"
          onClick={() => go(selectedClassId, row.attendanceDate)}
        >
          {row.attendanceDate === selectedDate ? "Editing" : "Edit"}
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {classes.length > 0 && (
        <label className="flex max-w-sm flex-col gap-1">
          <span className={LABEL_CLASS}>Class</span>
          {/* No "— today" marker on the weekday here, unlike the home screen's
              picker. This screen deliberately doesn't open on today's class (see
              the section), so flagging it would advertise a default that isn't
              in force. */}
          <select
            value={selectedClassId ?? ""}
            onChange={(event) =>
              // The date is dropped on a class change rather than carried over:
              // the day one class was last taken is almost never a day the next
              // one has a register for, and carrying it would open the editor on
              // a day that doesn't exist.
              go(event.target.value ? Number(event.target.value) : undefined)
            }
            className={SELECT_CLASS}
          >
            <option value="">Pick a class…</option>
            {classes.map((item) => {
              const weekday = weekdayLabel(item.classWeekday);

              return (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.enrolledCount})
                  {weekday && ` · ${weekday}`}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {/* Three list states, most-specific first: no classes at all, no class
          picked, and a class with nothing ever recorded. Each names the screen
          that can actually fix it. */}
      {classes.length === 0 ? (
        <p className={EMPTY_CLASS}>No classes yet — create one on the Classes screen first.</p>
      ) : selectedClassId === undefined ? (
        <p className={EMPTY_CLASS}>Pick a class above to see the days it has registers for.</p>
      ) : sessions.length === 0 ? (
        <p className={EMPTY_CLASS}>
          This class has no attendance recorded yet — there is nothing to correct. Take a
          register on the Home screen first.
        </p>
      ) : (
        <DataGrid
          columns={columns}
          rows={sessions}
          getRowKey={(row) => row.recordId}
          emptyMessage="No registers yet."
          exportFileName="attendance-registers"
          storageKey="myhomebase:attendance-registers-grid"
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => (
            <RegisterSelectionActions
              sessions={selectedRows}
              editingDate={selectedDate}
              onDeleted={(deletedDates) => {
                clearSelection();
                // Deleting the day currently open in the editor has to drop the
                // ?date= too, or the screen would keep rendering an editor for a
                // register that no longer exists until the refresh landed.
                if (selectedDate && deletedDates.includes(selectedDate)) {
                  go(selectedClassId);
                } else {
                  router.refresh();
                }
              }}
            />
          )}
        />
      )}

      {/* The editor, shown only once a day has been chosen. `sheet` is undefined
          until then, and also when a ?date= names a day with no register — the
          section resolves that rather than this view. */}
      {sheet && (
        <RegisterPanel
          // Remounting per class and date is what re-seeds the marks from the
          // newly loaded register: `RegisterPanel` reads `sheet.session` in a
          // state initializer, so without a changing key, switching days would
          // keep the previous day's ticks on screen. Same key the home screen
          // uses, and the reason is spelled out there.
          key={`${sheet.classId}:${sheet.attendanceDate}`}
          sheet={sheet}
          actions={actions}
          today={today}
          cardsUseLastNameFirst={cardsUseLastNameFirst}
        />
      )}

      {selectedClassId !== undefined && sessions.length > 0 && !sheet && (
        <p className={EMPTY_CLASS}>
          Pick a day above to correct its register.
        </p>
      )}
    </div>
  );
}

/**
 * What the batch selection can do: delete the chosen registers.
 *
 * Only one action, so this is a button rather than the toolbar the Rosters
 * screen builds — but it lives in `renderSelectionActions` for the same reason,
 * which is that `DataGrid` owns the selection and hands it over already
 * resolved to rows.
 */
function RegisterSelectionActions({
  sessions,
  editingDate,
  onDeleted,
}: {
  sessions: AttendanceSessionSummary[];
  /** The day open in the editor, if any — worth warning about before it goes. */
  editingDate?: string;
  /** Called with the deleted dates, so the caller can clear a stale ?date=. */
  onDeleted: (deletedDates: string[]) => void;
}) {
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(undefined);
    setMessage(undefined);

    // Deleting a register is not undoable and takes every mark and noted action
    // with it, so the dates are read back rather than just the count — the same
    // shape the roster's bulk delete uses, for the same reason. A few dates are
    // more checkable than a number; past three, the number is easier to read.
    const what =
      sessions.length <= 3
        ? sessions.map((session) => session.attendanceDate).join(", ")
        : `${sessions.length} registers`;
    const alsoEditing =
      editingDate && sessions.some((session) => session.attendanceDate === editingDate)
        ? " That includes the day you have open, and any unsaved marks on it will be lost."
        : "";

    if (
      !window.confirm(
        `Delete the attendance for ${what}? Every mark and noted action on ${
          sessions.length === 1 ? "that day" : "those days"
        } goes with it, and this can’t be undone.${alsoEditing}`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteAttendanceRecordsAction(
        sessions.map((session) => session.recordId),
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessage(`Deleted ${result.deleted}.`);
      onDeleted(sessions.map((session) => session.attendanceDate));
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {/* `danger`, not `secondary`: this is the one control in the module that
          destroys a saved register, and the button should look like it. */}
      <Button variant="danger" onClick={handleDelete} disabled={isPending}>
        {isPending ? "Deleting…" : "Delete registers"}
      </Button>
      {message && <span className="text-sm text-emerald-400">{message}</span>}
      {error && <span className="text-sm text-red-400">{error}</span>}
    </span>
  );
}
