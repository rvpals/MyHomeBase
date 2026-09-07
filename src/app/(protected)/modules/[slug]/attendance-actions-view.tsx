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
// A teacher who wants something outside those ten glyphs can upload their own
// artwork instead (migration 0082). That lives in the *edit* dialog only: the
// upload is stored against a row id, and the add form has no id yet. So the flow
// is add-then-upload, and the add form offers the built-in glyphs alone.
//
// Retiring rather than deleting is the main affordance on a used action. The grid
// makes both available and the server action explains the refusal, so a teacher
// never has to know the rule in advance.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AttendanceActionIcon } from "@/components/attendance-action-icon";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import {
  ATTENDANCE_ACTION_ICONS,
  ATTENDANCE_IMAGE_MIME_TYPES,
  MAX_ATTENDANCE_ACTION_ICON_BYTES,
  type CreateStudentActionInput,
  type StudentAction,
} from "@/lib/attendance";
import {
  clearStudentActionIconAction,
  createStudentActionAction,
  deleteStudentActionAction,
  setStudentActionActiveAction,
  setStudentActionIconAction,
  updateStudentActionAction,
} from "./attendance-actions";
import { studentActionIconUrl } from "./attendance-shared";

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
      render: (row) => {
        const uploaded = studentActionIconUrl(row);
        return (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brass-soft text-brass-dark">
            <AttendanceActionIcon name={row.icon} src={uploaded} className="h-4 w-4" />
            {!uploaded && !row.icon && <span className="font-mono text-[10px]">—</span>}
          </span>
        );
      },
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
            // Only the edit dialog gets the upload controls: they write against a
            // row id, which an unsaved action doesn't have yet.
            uploadFor={editing}
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
  uploadFor,
  submitLabel,
  onSubmit,
  onSuccess,
  onCancel,
  resetOnSuccess = false,
}: {
  initial?: CreateStudentActionInput;
  /**
   * The saved row, when this form is editing one. Present only then, which is
   * what gates the upload controls: they write against an id straight away
   * rather than through `onSubmit`, so an unsaved action has nothing to attach
   * artwork to.
   */
  uploadFor?: StudentAction;
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
      <div className="card-grid gap-4">
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
        <IconPicker
          value={icon}
          onChange={setIcon}
          // Greyed out while an upload is in force, because the upload wins and a
          // highlighted glyph would be claiming otherwise. Still clickable: the
          // choice made here is the fallback once the upload is removed.
          supersededBy={uploadFor && studentActionIconUrl(uploadFor)}
        />
        {uploadFor && <ActionIconUpload action={uploadFor} />}
      </div>

      <div className="card-grid gap-4">
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

/** Reads a File as bare base64 (no data-URL prefix), which is what the action wants. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload, replace or remove a teacher's own artwork for one action.
 *
 * Writes immediately rather than on the form's Save, matching how every other
 * per-row image in the app behaves (expense card art, journal taxonomy icons):
 * the bytes go to their own column through their own action, so folding them into
 * the row save would mean holding a file in state for no benefit.
 *
 * Uploaded artwork draws as its own bitmap and can't take the chip's text colour,
 * unlike the built-in glyphs — so a pale icon will look pale on the small chips.
 * Said out loud in the hint rather than prevented, because a teacher choosing
 * their own mark is entitled to choose a bad one.
 */
function ActionIconUpload({ action }: { action: StudentAction }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const url = studentActionIconUrl(action);

  async function handleFile(file: File) {
    setError(undefined);
    // Checked here as well as in the use-case so a large file is refused before
    // it's read and shipped, not after.
    if (file.size > MAX_ATTENDANCE_ACTION_ICON_BYTES) {
      setError(
        `"${file.name}" is too large — keep it under ${Math.round(MAX_ATTENDANCE_ACTION_ICON_BYTES / 1024)} KB.`,
      );
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await setStudentActionIconAction(action.id, file.type, base64Data);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemove() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await clearStudentActionIconAction(action.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <span className={LABEL_CLASS}>Or upload your own</span>

      {/* Stacks below 1024px — a 12px preview beside a dropzone has nowhere to go
          on a phone. */}
      <div className="flex items-center gap-3 max-lg:flex-col max-lg:items-stretch">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
          <img
            src={url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg border border-line object-contain max-lg:self-center"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted max-lg:self-center">
            None
          </div>
        )}
        <div className="flex-1">
          <FileDropzone
            accept={ATTENDANCE_IMAGE_MIME_TYPES.join(",")}
            disabled={isBusy}
            label={url ? "Drop a new icon here, or click to browse" : "Drop an icon here, or click to browse"}
            onFile={handleFile}
          />
        </div>
      </div>

      <p className="text-xs text-muted">
        A PNG, JPEG, WebP or GIF up to{" "}
        {Math.round(MAX_ATTENDANCE_ACTION_ICON_BYTES / 1024)} KB. It replaces the glyph
        everywhere the action appears, including the small code chips beside a student&apos;s
        name — where a square, high-contrast image reads best.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {url && (
        <button
          type="button"
          disabled={isBusy}
          onClick={handleRemove}
          className="self-start text-xs text-muted hover:text-red-400"
        >
          Remove upload
        </button>
      )}
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
  supersededBy,
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * URL of an upload that currently wins over this choice. When set, the grid
   * dims and says so — the selection still matters as the fallback once the
   * upload is removed, so it stays live rather than being disabled.
   */
  supersededBy?: string;
}) {
  return (
    <div className={supersededBy ? "opacity-50 transition-opacity" : undefined}>
      {supersededBy && (
        <p className="mb-2 text-xs text-muted">
          Your uploaded icon is in use. These stay as the fallback if you remove it.
        </p>
      )}
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
    </div>
  );
}
