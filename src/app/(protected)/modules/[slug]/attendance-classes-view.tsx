"use client";

// Classes: create one, and pick students from the roster to put in it.

import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import type { AttendanceClass, Student } from "@/lib/attendance";
import {
  createClassAction,
  deleteClassAction,
  enrollStudentsAction,
  removeStudentFromClassAction,
  updateClassAction,
} from "./attendance-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

function studentName(student: Student): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

export function AttendanceClassesView({
  classes,
  students,
  rosterByClassId,
}: {
  classes: AttendanceClass[];
  /** The whole roster, for the "add students" picker. */
  students: Student[];
  /** classId -> the students in it, loaded server-side. */
  rosterByClassId: Record<number, Student[]>;
}) {
  const [editing, setEditing] = useState<AttendanceClass>();
  const [managing, setManaging] = useState<AttendanceClass>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleDelete(item: AttendanceClass) {
    setError(undefined);
    startTransition(async () => {
      const result = await deleteClassAction(item.id);
      if (!result.ok) setError(result.error);
    });
  }

  const columns: DataGridColumn<AttendanceClass>[] = [
    {
      key: "name",
      header: "Class",
      value: (row) => row.name,
      render: (row) => row.name,
    },
    {
      key: "description",
      header: "Description",
      value: (row) => row.description,
      render: (row) => row.description || "—",
    },
    {
      key: "enrolledCount",
      header: "Students",
      value: (row) => row.enrolledCount,
      aggregate: "sum",
      render: (row) => row.enrolledCount,
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (row) => (
        <span className="flex gap-3">
          <button
            type="button"
            className="text-brass-dark hover:underline"
            onClick={() => setManaging(row)}
          >
            Students
          </button>
          <button
            type="button"
            className="text-brass-dark hover:underline"
            onClick={() => setEditing(row)}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-red-400 hover:underline"
            onClick={() => handleDelete(row)}
            disabled={isPending}
          >
            Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleCard title="Add a class" defaultOpen={classes.length === 0}>
        <ClassForm
          submitLabel="Add class"
          onSubmit={(values) => createClassAction(values)}
          resetOnSuccess
        />
      </CollapsibleCard>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <DataGrid
        columns={columns}
        rows={classes}
        getRowKey={(row) => row.id}
        emptyMessage="No classes yet."
        exportFileName="attendance-classes"
        storageKey="myhomebase:attendance-classes-grid"
      />

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(undefined)}>
          <ClassForm
            initial={{ name: editing.name, description: editing.description }}
            submitLabel="Save changes"
            onSubmit={(values) => updateClassAction(editing.id, values)}
            onSuccess={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        </Modal>
      )}

      {managing && (
        <Modal
          title={`Students in ${managing.name}`}
          size="lg"
          onClose={() => setManaging(undefined)}
        >
          <ClassRosterPanel
            attendanceClass={managing}
            enrolled={rosterByClassId[managing.id] ?? []}
            allStudents={students}
          />
        </Modal>
      )}
    </div>
  );
}

/** Who is in a class, plus a picker to add more from the roster. */
function ClassRosterPanel({
  attendanceClass,
  enrolled,
  allStudents,
}: {
  attendanceClass: AttendanceClass;
  enrolled: Student[];
  allStudents: Student[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const enrolledIds = new Set(enrolled.map((student) => student.id));
  const available = allStudents.filter((student) => !enrolledIds.has(student.id));

  function toggle(studentId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function handleAdd() {
    setError(undefined);
    setMessage(undefined);

    startTransition(async () => {
      const result = await enrollStudentsAction(attendanceClass.id, [...selectedIds]);
      if (result.ok) {
        setMessage(`Added ${result.addedCount}.`);
        setSelectedIds(new Set());
      } else {
        setError(result.error);
      }
    });
  }

  function handleRemove(studentId: number) {
    setError(undefined);
    startTransition(async () => {
      const result = await removeStudentFromClassAction(attendanceClass.id, studentId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h4 className="font-display text-base text-ink">Enrolled ({enrolled.length})</h4>
        {enrolled.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {enrolled.map((student) => (
              <li
                key={student.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-ink">{studentName(student)}</span>
                <button
                  type="button"
                  className="shrink-0 text-red-400 hover:underline"
                  onClick={() => handleRemove(student.id)}
                  disabled={isPending}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="font-display text-base text-ink">Add from the roster</h4>
        {available.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {allStudents.length === 0
              ? "No students on the roster yet."
              : "Everyone on the roster is already in this class."}
          </p>
        ) : (
          <>
            {/* Capped height: a roster of a few hundred would otherwise make the
                dialog itself scroll past the Add button. */}
            <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {available.map((student) => (
                <li key={student.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(student.id)}
                      onChange={() => toggle(student.id)}
                      disabled={isPending}
                    />
                    <span className="min-w-0 truncate text-ink">{studentName(student)}</span>
                    {student.studentIdentifier && (
                      <span className="ml-auto shrink-0 font-mono text-xs text-muted">
                        {student.studentIdentifier}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={handleAdd} disabled={isPending || selectedIds.size === 0}>
                {isPending ? "Adding…" : `Add ${selectedIds.size || ""}`.trim()}
              </Button>
              {message && <p className="text-sm text-emerald-400">{message}</p>}
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ClassForm({
  initial = { name: "", description: "" },
  submitLabel,
  onSubmit,
  onSuccess,
  onCancel,
  resetOnSuccess = false,
}: {
  initial?: { name: string; description: string };
  submitLabel: string;
  onSubmit: (values: { name: string; description: string }) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  onSuccess?: () => void;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) {
        if (resetOnSuccess) setValues({ name: "", description: "" });
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="card-grid gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Class name</span>
          <input
            required
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            className={INPUT_CLASS}
            placeholder="Math 101"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Description</span>
          <input
            value={values.description}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
            className={INPUT_CLASS}
            placeholder="Optional"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
