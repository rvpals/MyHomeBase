"use client";

// The "Bulk edit" dialog behind the Entries screen's tick-boxes, used by both
// tabs (Main and Log).
//
// Route-local, not a shared component: it is one screen's form over one
// module's fields. The reusable parts it is built from — `Modal`, `TokenPicker`,
// `Button` — are already in components.md.
//
// **Tick to enable.** A field does nothing until its checkbox is on, and only
// ticked fields are sent. This is the same shape as the Expense bulk edit, and
// for the same reason: a dialog of blank inputs is otherwise indistinguishable
// from "set all these to blank", which would be a quiet way to wipe a selection.
//
// **Modes, because these are lists.** Unlike Expense's single-valued fields, an
// entry holds *several* categories and tags, so "set this value" is not the only
// sensible instruction. Add appends, Remove strips, Replace overwrites — and
// Replace is called out in the hint, since it is the one that discards what the
// reader can't see on the rows.
//
// **Narrow behaviour:** the field grid is one column below 640px (`sm:` opens it
// to the label/control split), and `Modal` is already responsive.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TokenPicker } from "@/components/token-picker";
import type { BulkEntryEditInput, BulkNameMode, JournalEntry } from "@/lib/journal";
import { bulkEditJournalEntriesAction, type BulkRefreshScope } from "./journal-bulk-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const MODES: { value: BulkNameMode; label: string }[] = [
  { value: "add", label: "Add" },
  { value: "remove", label: "Remove" },
  { value: "replace", label: "Replace" },
];

export interface JournalEntriesBulkEditProps {
  /** The ticked rows. Only their ids are sent; the rest is for the count. */
  selected: JournalEntry[];
  categoryOptions: string[];
  tagOptions: string[];
  /** Which list the caller wants back after the write. */
  scope: BulkRefreshScope;
  onCancel: () => void;
  /** Handed the refreshed rows and the one-line summary to show. */
  onApplied: (entries: JournalEntry[], message: string) => void;
}

export function JournalEntriesBulkEdit({
  selected,
  categoryOptions,
  tagOptions,
  scope,
  onCancel,
  onApplied,
}: JournalEntriesBulkEditProps) {
  const [editCategories, setEditCategories] = useState(false);
  const [categoryMode, setCategoryMode] = useState<BulkNameMode>("add");
  const [categories, setCategories] = useState<string[]>([]);

  const [editTags, setEditTags] = useState(false);
  const [tagMode, setTagMode] = useState<BulkNameMode>("add");
  const [tags, setTags] = useState<string[]>([]);

  const [editPlaceName, setEditPlaceName] = useState(false);
  const [placeName, setPlaceName] = useState("");

  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const nothingEnabled = !editCategories && !editTags && !editPlaceName;

  // Replace is the only mode that means something with an empty list ("clear
  // this field"), so it is the only one that may be applied without names.
  const categoriesIncomplete =
    editCategories && categoryMode !== "replace" && categories.length === 0;
  const tagsIncomplete = editTags && tagMode !== "replace" && tags.length === 0;

  async function handleApply() {
    const changes: BulkEntryEditInput = {};
    if (editCategories) changes.categories = { mode: categoryMode, names: categories };
    if (editTags) changes.tags = { mode: tagMode, names: tags };
    if (editPlaceName) changes.placeName = placeName;

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await bulkEditJournalEntriesAction(
        selected.map((entry) => entry.id),
        changes,
        scope,
      );
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to edit the selected entries.");
        return;
      }
      onApplied(result.entries, result.message ?? "Entries updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to edit the selected entries.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title="Bulk edit entries"
      description={`${selected.length} ${selected.length === 1 ? "entry" : "entries"} selected. Only the fields you tick are changed; everything else is left alone.`}
      onClose={onCancel}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || nothingEnabled || categoriesIncomplete || tagsIncomplete}
            onClick={() => void handleApply()}
          >
            {isSaving ? "Applying…" : "Apply"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <NameField
          label="Categories"
          enabled={editCategories}
          onEnabledChange={setEditCategories}
          mode={categoryMode}
          onModeChange={setCategoryMode}
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          placeholder="Filter or add a category…"
        />

        <NameField
          label="Tags"
          enabled={editTags}
          onEnabledChange={setEditTags}
          mode={tagMode}
          onModeChange={setTagMode}
          value={tags}
          onChange={setTags}
          options={tagOptions}
          placeholder="Filter or add a tag…"
        />

        <div className="flex flex-col gap-2">
          <FieldToggle label="Place" enabled={editPlaceName} onEnabledChange={setEditPlaceName} />
          <input
            type="text"
            value={placeName}
            disabled={!editPlaceName}
            onChange={(event) => setPlaceName(event.target.value)}
            placeholder="e.g. Princeton University"
            aria-label="Place"
            className={`${INPUT_CLASS} disabled:opacity-40`}
          />
          {editPlaceName && placeName.trim() === "" && (
            <p className="text-xs text-muted">
              Left empty, this <span className="text-ink">clears</span> the place on every
              selected entry.
            </p>
          )}
        </div>

        <p className="text-xs text-muted">
          Locked entries are skipped — unlock one first if you meant to change it. Nothing here
          touches an entry&apos;s date, time, title or text.
        </p>
      </div>
    </Modal>
  );
}

/** The tick-box and label that gate one field. */
function FieldToggle({
  label,
  enabled,
  onEnabledChange,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
        className="h-4 w-4 accent-brass"
      />
      {label}
    </label>
  );
}

/**
 * One name-list field: the enable tick-box, the three modes, and the picker.
 *
 * The mode buttons are disabled rather than hidden while the field is off, so
 * the control doesn't change height when it's ticked — the dialog would
 * otherwise jump under the reader's cursor.
 */
function NameField({
  label,
  enabled,
  onEnabledChange,
  mode,
  onModeChange,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  mode: BulkNameMode;
  onModeChange: (next: BulkNameMode) => void;
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldToggle label={label} enabled={enabled} onEnabledChange={onEnabledChange} />
        <div
          role="group"
          aria-label={`How to apply ${label.toLowerCase()}`}
          className="flex items-center gap-1"
        >
          {MODES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={mode === option.value ? "primary" : "secondary"}
              disabled={!enabled}
              onClick={() => onModeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={enabled ? undefined : "pointer-events-none opacity-40"}>
        <TokenPicker
          label={label}
          value={value}
          onChange={onChange}
          options={options}
          allowCreate
          createPlaceholder={placeholder}
          hint={hintFor(label, mode)}
        />
      </div>
    </div>
  );
}

function hintFor(label: string, mode: BulkNameMode): string {
  const lower = label.toLowerCase();
  if (mode === "add") return `Appended to the ${lower} each entry already has.`;
  if (mode === "remove") return `Stripped from the selection. Other ${lower} are left alone.`;
  return `Replaces every entry's ${lower} outright — what they have now is discarded.`;
}
