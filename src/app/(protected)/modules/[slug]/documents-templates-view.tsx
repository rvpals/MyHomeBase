"use client";

// The Prefill Templates screen for the Document Library: the list of templates, and
// the editor that builds one field by field.
//
// Route-local rather than registered — nothing outside the Document Library renders
// this. The pieces it is made of (CollapsibleCard, Button, Modal, TreeIcon) all come
// from the registry.
//
// Ported from `journal-templates-view.tsx`, deliberately down to the layout: a filer
// who has built a journal template should recognise this screen. The one structural
// difference is that there are no literal/dynamic radios, because a document has no
// date or time field and so nothing to resolve at apply-time. See migration 0169.
//
// No logic here: which fields exist, which of them suggest, and what counts as a
// valid template all come from `@/lib/documents/prefill`.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { TokenPicker } from "@/components/token-picker";
import { TreeIcon } from "@/components/tree-icons";
// From the leaf modules, not the barrel: see the note in documents-main-view.tsx —
// the barrel re-exports the file store, which imports `node:fs/promises`, and pulling
// that into a client component fails the production build (Turbopack: "the chunking
// context does not support external modules"). `prefill.ts` imports only types and
// the schema, so reaching it directly is safe.
import {
  DOCUMENT_PREFILL_FIELDS,
  describePrefillFields,
  documentPrefillFieldLabel,
  joinPrefillList,
  splitPrefillList,
} from "@/lib/documents/prefill";
import type {
  DocumentPrefillField,
  DocumentPrefillFieldValue,
  DocumentPrefillTemplate,
} from "@/lib/documents/types";
import {
  deleteDocumentPrefillTemplateAction,
  saveDocumentPrefillTemplateAction,
  setDocumentPrefillTemplateEnabledAction,
} from "./documents-prefill-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// --- The editor --------------------------------------------------------------

/**
 * One row of the editor: which field, and what value.
 *
 * Kept as local state in a plain array rather than as a controlled list keyed by
 * field, because a half-built row (a field picked, no value yet) is a normal state
 * the filer passes through and a keyed map has nowhere to put it.
 */
interface DraftRow {
  /** Stable across re-orders and deletions, so React keys don't shuffle inputs. */
  key: number;
  field: DocumentPrefillField;
  value: string;
}

let nextDraftKey = 1;

function newDraftRow(field: DocumentPrefillField): DraftRow {
  return { key: nextDraftKey++, field, value: "" };
}

function toDraftRows(fields: DocumentPrefillFieldValue[]): DraftRow[] {
  return fields.map((entry) => ({
    key: nextDraftKey++,
    field: entry.field,
    value: entry.value,
  }));
}

function DocumentPrefillTemplateEditor({
  /** The template being edited, or undefined when adding a new one. */
  template,
  suggestions,
  onDone,
  onCancel,
}: {
  template?: DocumentPrefillTemplate;
  suggestions: Record<DocumentPrefillField, string[]>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[]>(() =>
    template ? toDraftRows(template.fields) : [newDraftRow("categories")],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  // The name/description prompt. Opened by Save; pre-filled when editing, so an edit
  // doesn't make the filer retype a name they already chose.
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");

  // Fields already used, so the dropdown can grey them out rather than let a filer
  // build something the schema will reject.
  const usedFields = new Set(rows.map((row) => row.field));

  function updateRow(key: number, patch: Partial<DraftRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    const unused = DOCUMENT_PREFILL_FIELDS.find((entry) => !usedFields.has(entry.field));
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
      const result = await saveDocumentPrefillTemplateAction({
        id: template?.id,
        name,
        description,
        isEnabled: template?.isEnabled ?? true,
        fields: rows.map((row) => ({ field: row.field, mode: "literal", value: row.value })),
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

  const allFieldsUsed = rows.length >= DOCUMENT_PREFILL_FIELDS.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Pick a field, then the value a new document should start with. Add as many fields as
        you like — anything you leave out is simply not filled.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {rows.map((row) => {
          const definition = DOCUMENT_PREFILL_FIELDS.find((entry) => entry.field === row.field);
          return (
            // Stacks on a phone, three columns from `sm` up: field, value, and the
            // remove button. `max-lg:` isn't enough here — the row has three controls
            // and 390px can't carry them side by side at any size.
            <div
              key={row.key}
              className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-start"
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink sm:sr-only">Field</span>
                <select
                  value={row.field}
                  onChange={(event) =>
                    updateRow(row.key, { field: event.target.value as DocumentPrefillField })
                  }
                  className={`${SELECT_CLASS} w-full`}
                >
                  {DOCUMENT_PREFILL_FIELDS.map((entry) => (
                    <option
                      key={entry.field}
                      value={entry.field}
                      // The field this row already holds must stay selectable, or the
                      // select would have no valid current value.
                      disabled={entry.field !== row.field && usedFields.has(entry.field)}
                    >
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="min-w-0">
                {definition?.kind === "list" ? (
                  // The same combobox the New Document screen fills these two fields
                  // with (components.md → TokenPicker). A template's value box should
                  // behave like the field it is going to fill: the same chips, the same
                  // vocabulary, the same `+ Create` for a name the library does not have
                  // yet. A plain text box with a datalist looked like a different kind
                  // of field, and left the filer to guess the delimiter.
                  //
                  // The template stores one comma-separated string, so the conversion
                  // happens here, at the control — through `splitPrefillList` /
                  // `joinPrefillList` from lib, which are the same two functions the
                  // editor form applies a template with. The delimiter rule has exactly
                  // one home, and this view does not parse anything.
                  // Labelled with the FIELD's name, not "Value". TokenPicker always
                  // renders its label, while the text rows hide theirs from `sm` up
                  // (the select beside them already says which field it is) — so a
                  // literal "Value" here would be the one visible heading in a column
                  // of rows that have none. The field name is the honest thing to put
                  // in a label that cannot be hidden.
                  <TokenPicker
                    label={definition.label}
                    hint={definition.hint}
                    value={splitPrefillList(row.value)}
                    onChange={(names) => updateRow(row.key, { value: joinPrefillList(names) })}
                    options={suggestions[row.field] ?? []}
                    allowCreate
                    createPlaceholder={
                      row.field === "categories"
                        ? "Filter or add a category…"
                        : "Filter or add a tag…"
                    }
                  />
                ) : (
                  <>
                    <span className="mb-1 block text-sm font-medium text-ink sm:sr-only">
                      Value
                    </span>
                    {definition?.kind === "multiline" ? (
                      <textarea
                        value={row.value}
                        onChange={(event) => updateRow(row.key, { value: event.target.value })}
                        rows={4}
                        className={`${INPUT_CLASS} resize-y`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={row.value}
                        onChange={(event) => updateRow(row.key, { value: event.target.value })}
                        className={INPUT_CLASS}
                      />
                    )}
                    {definition && (
                      <span className="mt-1 block text-xs text-muted">{definition.hint}</span>
                    )}
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove the ${documentPrefillFieldLabel(row.field)} field`}
                title="Remove this field"
                className="justify-self-start rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:justify-self-auto"
              >
                <TreeIcon name="trash" className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

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
          description="A name to pick it by on the New Document screen, and an optional note about when to use it."
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
                placeholder="e.g. Utility bill"
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

export function DocumentsTemplatesView({
  templates,
  suggestions,
}: {
  templates: DocumentPrefillTemplate[];
  /** Field → autocomplete values, read on the server. */
  suggestions: Record<DocumentPrefillField, string[]>;
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const editing = templates.find((template) => template.id === editingId);

  async function handleToggle(template: DocumentPrefillTemplate) {
    setBusyId(template.id);
    setError(undefined);
    try {
      const result = await setDocumentPrefillTemplateEnabledAction(
        template.id,
        !template.isEnabled,
      );
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleDelete(template: DocumentPrefillTemplate) {
    // A template is copied into the form at apply-time and nothing links back, so
    // this only ever loses the template itself — a plain confirm is enough.
    if (!window.confirm(`Delete the prefill template "${template.name}"?`)) return;
    setBusyId(template.id);
    setError(undefined);
    try {
      const result = await deleteDocumentPrefillTemplateAction(template.id);
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
          A template is a named set of field values a new document can start from. Pick one on
          the New Document screen and it fills the fields you left blank — it never overwrites
          something you have already typed or chosen.
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
                  <p className="mt-1 text-xs text-muted">
                    {describePrefillFields(template.fields)}
                  </p>
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
            <DocumentPrefillTemplateEditor
              // Remounts when a different template is picked, so the editor's draft
              // rows reload rather than carrying the previous one's.
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
            ariaControls="documents-add-prefill-template"
          >
            Add Prefill Template
          </Button>
        </div>

        {isAdding && (
          <div id="documents-add-prefill-template">
            <CollapsibleCard title="Add prefill template" defaultOpen>
              <DocumentPrefillTemplateEditor
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
