"use client";

// The Templates screen for My Journal's Configuration group: the list of prefill
// templates, and the editor that builds one field by field.
//
// Route-local rather than registered — nothing outside My Journal renders this.
// The pieces it is made of (CollapsibleCard, Button, Modal, TreeIcon) all come
// from the registry.
//
// No logic here: which fields exist, whether a field may be dynamic, and what
// counts as a valid template all come from `@/lib/journal`.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import {
  JOURNAL_PREFILL_FIELDS,
  prefillFieldAllowsNow,
  prefillFieldLabel,
  type JournalPrefillField,
  type JournalPrefillFieldValue,
  type JournalPrefillTemplate,
} from "@/lib/journal";
import {
  deletePrefillTemplateAction,
  savePrefillTemplateAction,
  setPrefillTemplateEnabledAction,
} from "./journal-prefill-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Datalist id for one field's suggestions. One list per field, rendered once. */
function suggestionListId(field: JournalPrefillField): string {
  return `journal-prefill-suggestions-${field}`;
}

/** A one-line summary of what a template fills, for the list row. */
function describeFields(fields: JournalPrefillFieldValue[]): string {
  if (fields.length === 0) return "No fields yet.";
  return fields
    .map((entry) => {
      const label = prefillFieldLabel(entry.field);
      if (entry.mode === "now") return `${label}: current`;
      return `${label}: ${entry.value}`;
    })
    .join(" · ");
}

// --- The editor --------------------------------------------------------------

/**
 * One row of the editor: which field, and what value.
 *
 * Kept as local state in a plain array rather than as a controlled list keyed by
 * field, because a half-built row (a field picked, no value yet) is a normal
 * state the writer passes through and a keyed map has nowhere to put it.
 */
interface DraftRow {
  /** Stable across re-orders and deletions, so React keys don't shuffle inputs. */
  key: number;
  field: JournalPrefillField;
  mode: "literal" | "now";
  value: string;
}

let nextDraftKey = 1;

function newDraftRow(field: JournalPrefillField): DraftRow {
  // Date and time default to the dynamic mode, because that is what they are
  // almost always wanted for — a literal date would pin every new entry to a
  // fixed day. The writer can still switch to a literal.
  const mode = prefillFieldAllowsNow(field) ? "now" : "literal";
  return { key: nextDraftKey++, field, mode, value: "" };
}

function toDraftRows(fields: JournalPrefillFieldValue[]): DraftRow[] {
  return fields.map((entry) => ({
    key: nextDraftKey++,
    field: entry.field,
    mode: entry.mode,
    value: entry.value,
  }));
}

function PrefillTemplateEditor({
  /** The template being edited, or undefined when adding a new one. */
  template,
  suggestions,
  onDone,
  onCancel,
}: {
  template?: JournalPrefillTemplate;
  suggestions: Record<JournalPrefillField, string[]>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[]>(() =>
    template ? toDraftRows(template.fields) : [newDraftRow("date")],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  // The name/description prompt. Opened by Save; pre-filled when editing, so an
  // edit doesn't make the writer retype a name they already chose.
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");

  // Fields already used, so the dropdown can grey them out rather than let a
  // writer build something the schema will reject.
  const usedFields = new Set(rows.map((row) => row.field));

  function updateRow(key: number, patch: Partial<DraftRow>) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // Switching to a field that can't be dynamic drops the dynamic mode,
        // otherwise the row would carry a mode its field rejects.
        if (!prefillFieldAllowsNow(next.field) && next.mode === "now") next.mode = "literal";
        return next;
      }),
    );
  }

  function addRow() {
    const unused = JOURNAL_PREFILL_FIELDS.find((entry) => !usedFields.has(entry.field));
    if (!unused) return; // every field is already on the template
    setRows((current) => [...current, newDraftRow(unused.field)]);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await savePrefillTemplateAction({
        id: template?.id,
        name,
        description,
        isEnabled: template?.isEnabled ?? true,
        fields: rows.map((row) => ({ field: row.field, mode: row.mode, value: row.value })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsNaming(false);
      onDone();
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const allFieldsUsed = rows.length >= JOURNAL_PREFILL_FIELDS.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Pick a field, then the value a new entry should start with. Add as many fields as you
        like — anything you leave out is simply not filled.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {rows.map((row) => {
          const definition = JOURNAL_PREFILL_FIELDS.find((entry) => entry.field === row.field);
          const canBeDynamic = prefillFieldAllowsNow(row.field);
          const isDynamic = row.mode === "now";
          return (
            // Stacks on a phone, three columns from `sm` up: field, value, and
            // the remove button. `max-lg:` isn't enough here — the row has three
            // controls and 390px can't carry them side by side at any size.
            <div
              key={row.key}
              className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-start"
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink sm:sr-only">Field</span>
                <select
                  value={row.field}
                  onChange={(event) =>
                    updateRow(row.key, { field: event.target.value as JournalPrefillField })
                  }
                  className={`${SELECT_CLASS} w-full`}
                >
                  {JOURNAL_PREFILL_FIELDS.map((entry) => (
                    <option
                      key={entry.field}
                      value={entry.field}
                      // The field this row already holds must stay selectable,
                      // or the select would have no valid current value.
                      disabled={entry.field !== row.field && usedFields.has(entry.field)}
                    >
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="min-w-0">
                <span className="mb-1 block text-sm font-medium text-ink sm:sr-only">Value</span>
                {canBeDynamic && (
                  <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`prefill-mode-${row.key}`}
                        checked={isDynamic}
                        onChange={() => updateRow(row.key, { mode: "now", value: "" })}
                      />
                      <span className="text-ink">
                        {row.field === "date" ? "Current date" : "Current time"}
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`prefill-mode-${row.key}`}
                        checked={!isDynamic}
                        onChange={() => updateRow(row.key, { mode: "literal" })}
                      />
                      <span className="text-ink">A fixed value</span>
                    </label>
                  </div>
                )}

                {!isDynamic &&
                  (definition?.kind === "multiline" ? (
                    <textarea
                      value={row.value}
                      onChange={(event) => updateRow(row.key, { value: event.target.value })}
                      rows={4}
                      className={`${INPUT_CLASS} resize-y`}
                    />
                  ) : (
                    <input
                      type={
                        definition?.kind === "date"
                          ? "date"
                          : definition?.kind === "time"
                            ? "time"
                            : "text"
                      }
                      value={row.value}
                      onChange={(event) => updateRow(row.key, { value: event.target.value })}
                      list={suggestionListId(row.field)}
                      className={INPUT_CLASS}
                    />
                  ))}

                {definition && <span className="mt-1 block text-xs text-muted">{definition.hint}</span>}
              </div>

              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove the ${prefillFieldLabel(row.field)} field`}
                title="Remove this field"
                className="justify-self-start rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:justify-self-auto"
              >
                <TreeIcon name="trash" className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* One datalist per field, rendered once and shared by every row that
          selects that field. */}
      {JOURNAL_PREFILL_FIELDS.map((entry) => (
        <datalist key={entry.field} id={suggestionListId(entry.field)}>
          {(suggestions[entry.field] ?? []).map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={addRow} disabled={allFieldsUsed}>
          Add another field
        </Button>
        <Button onClick={() => setIsNaming(true)} disabled={isBusy || rows.length === 0}>
          Save the prefill template
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </div>
      {allFieldsUsed && (
        <p className="text-xs text-muted">Every available field is already on this template.</p>
      )}

      {isNaming && (
        <Modal
          title={template ? "Rename this template" : "Name this template"}
          description="A name to pick it by on the New Entry screen, and an optional note about when to use it."
          onClose={() => setIsNaming(false)}
          isBusy={isBusy}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsNaming(false)} disabled={isBusy}>
                Back
              </Button>
              <Button onClick={handleSave} disabled={isBusy || name.trim() === ""}>
                {isBusy ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error && <p className="text-sm text-red-400">{error}</p>}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Gym session"
                className={INPUT_CLASS}
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="When to reach for this one."
                rows={3}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- The screen --------------------------------------------------------------

export function JournalTemplatesView({
  templates,
  suggestions,
}: {
  templates: JournalPrefillTemplate[];
  /** Field → autocomplete values, read on the server. */
  suggestions: Record<JournalPrefillField, string[]>;
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const editing = templates.find((template) => template.id === editingId);

  async function handleToggle(template: JournalPrefillTemplate) {
    setBusyId(template.id);
    setError(undefined);
    try {
      const result = await setPrefillTemplateEnabledAction(template.id, !template.isEnabled);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleDelete(template: JournalPrefillTemplate) {
    // A template is copied into an entry at apply-time and nothing links back,
    // so this only ever loses the template itself — a plain confirm is enough.
    if (!window.confirm(`Delete the prefill template "${template.name}"?`)) return;
    setBusyId(template.id);
    setError(undefined);
    try {
      const result = await deletePrefillTemplateAction(template.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <CollapsibleCard title="Prefill Templates" defaultOpen>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          A template is a named set of field values a new entry can start from. Pick one on the
          New Entry screen and it fills the fields you left blank — it never overwrites something
          you have already typed.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {templates.length === 0 ? (
          <p className="text-sm text-muted">No prefill templates yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-line p-3"
              >
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdding(false);
                      setEditingId(editingId === template.id ? undefined : template.id);
                    }}
                    aria-label={`Edit the template "${template.name}"`}
                    title="Edit"
                    className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  >
                    <TreeIcon name="pencil" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(template)}
                    disabled={busyId === template.id}
                    aria-label={`Delete the template "${template.name}"`}
                    title="Delete"
                    className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <TreeIcon name="trash" className="h-4 w-4" />
                  </button>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {template.name}
                    {!template.isEnabled && (
                      <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-muted">
                        Disabled
                      </span>
                    )}
                  </p>
                  {template.description !== "" && (
                    <p className="mt-0.5 text-sm text-muted">{template.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted">{describeFields(template.fields)}</p>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggle(template)}
                  disabled={busyId === template.id}
                >
                  {template.isEnabled ? "Disable" : "Enable"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <CollapsibleCard title={`Edit “${editing.name}”`} defaultOpen className="mt-2">
            <PrefillTemplateEditor
              // Remounts when a different template is picked, so the editor's
              // draft rows reload rather than carrying the previous one's.
              key={editing.id}
              template={editing}
              suggestions={suggestions}
              onDone={() => setEditingId(undefined)}
              onCancel={() => setEditingId(undefined)}
            />
          </CollapsibleCard>
        )}

        <div>
          <Button
            onClick={() => {
              setEditingId(undefined);
              setIsAdding((current) => !current);
            }}
            ariaExpanded={isAdding}
            ariaControls="journal-add-prefill-template"
          >
            Add Prefill Template
          </Button>
        </div>

        {isAdding && (
          <div id="journal-add-prefill-template">
            <CollapsibleCard title="Add prefill template" defaultOpen>
              <PrefillTemplateEditor
                suggestions={suggestions}
                onDone={() => setIsAdding(false)}
                onCancel={() => setIsAdding(false)}
              />
            </CollapsibleCard>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
