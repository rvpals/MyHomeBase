"use client";

// Student actions: the catalog of things a teacher can note about a student on
// the day — Late, Extra Credit, and whatever else this class needs.
//
// Mirrors the Classes screen: a CollapsibleCard form to add one, a DataGrid of
// what exists, and a Modal to edit. The one thing it adds is the icon picker,
// which draws from the module's own small glyph set (ATTENDANCE_ACTION_ICONS)
// rather than the user-selectable module/tree icon sets — see
// src/components/attendance-action-icon.tsx for why.
//
// Retiring rather than deleting is the main affordance on a used action. The grid
// makes both available and the server action explains the refusal, so a teacher
// never has to know the rule in advance.

import { useState, useTransition } from "react";
import { AttendanceActionIcon } from "@/components/attendance-action-icon";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import {
  ATTENDANCE_ACTION_ICONS,
  type CreateStudentActionInput,
  type StudentAction,
} from "@/lib/attendance";
import {
  createStudentActionAction,
  deleteStudentActionAction,
  setStudentActionActiveAction,
  updateStudentActionAction,
} from "./attendance-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export function AttendanceActionsView({ actions }: { actions: StudentAction[] }) {
  const [editing, setEditing] = useState<StudentAction>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleDelete(row: StudentAction) {
    setError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = await deleteStudentActionAction(row.id);
      // A refusal here is expected rather than exceptional — the action has been
      // recorded, and the message says to retire it instead.
      if (!result.ok) setError(result.error);
      else setMessage(`Deleted "${row.name}".`);
    });
  }

  function handleSetActive(row: StudentAction, isActive: boolean) {
    setError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = await setStudentActionActiveAction(row.id, isActive);
      if (!result.ok) setError(result.error);
      else setMessage(`"${row.name}" is now ${isActive ? "in use" : "retired"}.`);
    });
  }

  const columns: DataGridColumn<StudentAction>[] = [
    {
      key: "icon",
      header: "Icon",
      // No `value`: a glyph key isn't something to sort, search or export a
      // column of. The code beside it is the sortable identity.
      sortable: false,
      minWidth: 56,
      render: (row) => (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brass-soft text-brass-dark">
          <AttendanceActionIcon name={row.icon} className="h-4 w-4" />
          {!row.icon && <span className="font-mono text-[10px]">—</span>}
        </span>
      ),
    },
    {
      key: "code",
      header: "Code",
      value: (row) => row.code,
      render: (row) => (
        <span className="font-mono font-semibold text-brass-dark">{row.code}</span>
      ),
    },
    {
      key: "name",
      header: "Action",
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
      key: "sequence",
      header: "Order",
      value: (row) => row.sequence,
      render: (row) => row.sequence,
    },
    {
      key: "isActive",
      header: "Status",
      value: (row) => (row.isActive ? "In use" : "Retired"),
      render: (row) =>
        row.isActive ? (
          <span className="text-ink">In use</span>
        ) : (
          <span className="text-muted">Retired</span>
        ),
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
            className="text-brass-dark hover:underline"
            onClick={() => handleSetActive(row, !row.isActive)}
            disabled={isPending}
          >
            {row.isActive ? "Retire" : "Bring back"}
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
      <CollapsibleCard title="Add an action" defaultOpen={actions.length === 0}>
        <ActionForm
          submitLabel="Add action"
          onSubmit={(values) => createStudentActionAction(values)}
          resetOnSuccess
        />
      </CollapsibleCard>

      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <DataGrid
        columns={columns}
        rows={actions}
        getRowKey={(row) => row.id}
        emptyMessage="No actions yet — add one above and it appears on the register's ⚡ button."
        exportFileName="attendance-student-actions"
        storageKey="myhomebase:attendance-actions-grid"
      />

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(undefined)}>
          <ActionForm
            initial={{
              name: editing.name,
              code: editing.code,
              description: editing.description,
              icon: editing.icon as CreateStudentActionInput["icon"],
              sequence: editing.sequence,
              isActive: editing.isActive,
            }}
            submitLabel="Save changes"
            onSubmit={(values) => updateStudentActionAction(editing.id, values)}
            onSuccess={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * The add/edit form for one action.
 *
 * Serves both cases, the way `ClassForm` does on the Classes screen — the fields
 * are identical, and two copies would drift.
 */
function ActionForm({
  initial,
  submitLabel,
  onSubmit,
  onSuccess,
  onCancel,
  resetOnSuccess = false,
}: {
  initial?: CreateStudentActionInput;
  submitLabel: string;
  onSubmit: (values: CreateStudentActionInput) => Promise<{ ok: boolean; error?: string }>;
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Clears the fields after a successful save — right for "add", not for "edit". */
  resetOnSuccess?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<string>(initial?.icon ?? "");
  const [sequence, setSequence] = useState(String(initial?.sequence ?? 0));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(undefined);

    startTransition(async () => {
      const result = await onSubmit({
        name,
        code,
        description,
        icon: icon as CreateStudentActionInput["icon"],
        // A blank or non-numeric box means "leave it at the front" rather than an
        // error — the order is a convenience, not a fact worth refusing a save
        // over. The schema still rejects a negative one.
        sequence: Number(sequence) || 0,
        isActive,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (resetOnSuccess) {
        setName("");
        setCode("");
        setDescription("");
        setIcon("");
        setSequence("0");
        setIsActive(true);
      }
      onSuccess?.();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Two columns on a desktop, one below 1024px — max-lg: so the wide layout
          provably can't regress. */}
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Late"
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Code</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="L"
            maxLength={6}
            // Uppercased for real by the schema; this is so the box shows what
            // will be stored rather than surprising the teacher after saving.
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Description</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Being late to class."
          className={INPUT_CLASS}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Icon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Order in the picker</span>
          <input
            type="number"
            min={0}
            value={sequence}
            onChange={(event) => setSequence(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex items-center gap-2 self-end py-1.5">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 accent-brass"
          />
          <span className="text-sm text-ink">
            In use
            <span className="block text-xs text-muted">
              Unticked, it stays on past registers but drops out of the picker.
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Pick one glyph, or none.
 *
 * A grid of the glyphs themselves rather than a `<select>` of their names: the
 * whole point of choosing an icon is seeing it, and "dollar-plus" in a dropdown
 * tells a teacher nothing. Small enough a set (ten) that a grid fits without
 * scrolling at any width.
 *
 * `IconSelect` from components.md is the wrong fit — it carries an uploaded
 * *image* per option, where these are code-drawn glyphs with no URL.
 */
function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {/* "None" first, so it reads as the starting state rather than as an
          eleventh icon hidden at the end. */}
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={value === ""}
        title="No icon — the code alone"
        className={`flex h-11 w-11 items-center justify-center rounded-md border font-mono text-xs transition-colors ${
          value === ""
            ? "border-brass bg-brass text-paper"
            : "border-line bg-paper text-muted hover:border-brass hover:text-ink"
        }`}
      >
        —
      </button>

      {ATTENDANCE_ACTION_ICONS.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onChange(name)}
          aria-pressed={value === name}
          title={name}
          aria-label={name}
          className={`flex h-11 w-11 items-center justify-center rounded-md border transition-colors ${
            value === name
              ? "border-brass bg-brass text-paper"
              : "border-line bg-paper text-muted hover:border-brass hover:text-ink"
          }`}
        >
          <AttendanceActionIcon name={name} className="h-5 w-5" />
        </button>
      ))}
    </div>
  );
}
