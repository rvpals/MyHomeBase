"use client";

// The roster: add a student, and select several to add to an existing class.

import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import type { AttendanceClass, Student } from "@/lib/attendance";
import type { NamedMapping } from "@/lib/csv-import";
import { AttendanceRosterImportView } from "./attendance-roster-import-view";
import {
  addStudentAction,
  deleteStudentAction,
  deleteStudentsAction,
  enrollStudentsAction,
  updateStudentAction,
} from "./attendance-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

interface StudentFormState {
  firstName: string;
  lastName: string;
  studentIdentifier: string;
  email: string;
  note: string;
}

const EMPTY_FORM: StudentFormState = {
  firstName: "",
  lastName: "",
  studentIdentifier: "",
  email: "",
  note: "",
};

export function AttendanceRostersView({
  students,
  classes,
  importMappings,
}: {
  students: Student[];
  classes: AttendanceClass[];
  /** Saved column mappings for the roster CSV importer. */
  importMappings: NamedMapping[];
}) {
  const [editing, setEditing] = useState<Student>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleDelete(student: Student) {
    setError(undefined);
    startTransition(async () => {
      const result = await deleteStudentAction(student.id);
      if (!result.ok) setError(result.error);
    });
  }

  const columns: DataGridColumn<Student>[] = [
    {
      key: "name",
      header: "Name",
      value: (row) => `${row.lastName}, ${row.firstName}`,
      render: (row) => `${row.firstName} ${row.lastName}`,
    },
    {
      key: "studentIdentifier",
      header: "Student ID",
      value: (row) => row.studentIdentifier,
      render: (row) => <span className="font-mono text-xs">{row.studentIdentifier || "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      value: (row) => row.email,
      render: (row) => row.email || "—",
    },
    {
      key: "note",
      header: "Note",
      value: (row) => row.note,
      render: (row) => row.note || "—",
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
      <CollapsibleCard title="Add a student" defaultOpen={students.length === 0}>
        <StudentForm
          onSubmit={(values) => addStudentAction(values)}
          submitLabel="Add student"
          resetOnSuccess
        />
      </CollapsibleCard>

      {/* Collapsed by default: importing is an occasional, start-of-term job,
          and the roster itself is what this screen is for. */}
      <CollapsibleCard title="Import a roster (CSV)">
        <AttendanceRosterImportView namedMappings={importMappings} />
      </CollapsibleCard>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <DataGrid
        columns={columns}
        rows={students}
        getRowKey={(row) => row.id}
        emptyMessage="No students yet."
        exportFileName="attendance-roster"
        storageKey="myhomebase:attendance-roster-grid"
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => (
          <RosterSelectionActions
            students={selectedRows}
            classes={classes}
            onDone={clearSelection}
          />
        )}
      />

      {editing && (
        <Modal title={`Edit ${editing.firstName} ${editing.lastName}`} onClose={() => setEditing(undefined)}>
          <StudentForm
            initial={{
              firstName: editing.firstName,
              lastName: editing.lastName,
              studentIdentifier: editing.studentIdentifier,
              email: editing.email,
              note: editing.note,
            }}
            submitLabel="Save changes"
            onSubmit={(values) => updateStudentAction(editing.id, values)}
            onSuccess={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * The bulk actions on the roster grid: add the ticked students to a class, or
 * delete them outright.
 *
 * `onDone` is called once a write lands, so the ticks don't outlive the action
 * they described. Both actions share one busy flag and one message line: they
 * act on the same selection, so letting one run while the other is mid-flight
 * would report a count against a selection that had already changed.
 */
function RosterSelectionActions({
  students,
  classes,
  onDone,
}: {
  students: Student[];
  classes: AttendanceClass[];
  onDone: () => void;
}) {
  const [classId, setClassId] = useState<string>("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(undefined);
    setMessage(undefined);

    const targetId = Number(classId);
    if (!targetId) {
      setError("Pick a class.");
      return;
    }

    startTransition(async () => {
      const result = await enrollStudentsAction(
        targetId,
        students.map((student) => student.id),
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const skipped = result.skippedCount
        ? `, ${result.skippedCount} already enrolled`
        : "";
      setMessage(`Added ${result.addedCount}${skipped}.`);
      onDone();
    });
  }

  function handleDelete() {
    setError(undefined);
    setMessage(undefined);

    // Deleting a person off the roster is not undoable, and the count is the
    // part worth reading back before confirming.
    const names =
      students.length <= 3
        ? students.map((student) => `${student.firstName} ${student.lastName}`).join(", ")
        : `${students.length} students`;
    if (!window.confirm(`Delete ${names} from the roster? This can’t be undone.`)) return;

    startTransition(async () => {
      const result = await deleteStudentsAction(students.map((student) => student.id));

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessage(`Deleted ${result.count}.`);
      onDone();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {/* Enrolling needs somewhere to enroll *to*, so the picker and its button
          drop out entirely with no classes yet — but Delete still applies. */}
      {classes.length === 0 ? (
        <span className="text-sm text-muted">Create a class to enroll into.</span>
      ) : (
        <>
          <select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            className={INPUT_CLASS}
            aria-label="Class to add the selected students to"
          >
            <option value="">Add to class…</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleAdd} disabled={isPending}>
            {isPending ? "Working…" : `Add ${students.length}`}
          </Button>
        </>
      )}
      <Button size="sm" variant="danger" onClick={handleDelete} disabled={isPending}>
        {isPending ? "Working…" : `Delete ${students.length}`}
      </Button>
      {message && <span className="text-sm text-emerald-400">{message}</span>}
      {error && <span className="text-sm text-red-400">{error}</span>}
    </span>
  );
}

function StudentForm({
  initial = EMPTY_FORM,
  submitLabel,
  onSubmit,
  onSuccess,
  onCancel,
  resetOnSuccess = false,
}: {
  initial?: StudentFormState;
  submitLabel: string;
  onSubmit: (values: StudentFormState) => Promise<{ ok: boolean; error?: string }>;
  onSuccess?: () => void;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}) {
  const [values, setValues] = useState<StudentFormState>(initial);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function setField(field: keyof StudentFormState, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) {
        if (resetOnSuccess) setValues(EMPTY_FORM);
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
          <span className={LABEL_CLASS}>First name</span>
          <input
            required
            value={values.firstName}
            onChange={(event) => setField("firstName", event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Last name</span>
          <input
            required
            value={values.lastName}
            onChange={(event) => setField("lastName", event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Student ID</span>
          <input
            value={values.studentIdentifier}
            onChange={(event) => setField("studentIdentifier", event.target.value)}
            className={INPUT_CLASS}
            placeholder="Optional"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Email</span>
          <input
            type="email"
            value={values.email}
            onChange={(event) => setField("email", event.target.value)}
            className={INPUT_CLASS}
            placeholder="Optional"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Note</span>
        <input
          value={values.note}
          onChange={(event) => setField("note", event.target.value)}
          className={INPUT_CLASS}
          placeholder="Optional"
        />
      </label>

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
