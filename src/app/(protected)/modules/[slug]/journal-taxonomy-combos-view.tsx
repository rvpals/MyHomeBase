"use client";

// The "Prefill Tags & Category Combo" tab on My Journal's Meta Data screen: the
// list of saved combos, an editor for one, and the "Add New Combo" card.
//
// A combo is a named pairing of categories and tags that either entry editor can
// fill both taxonomy fields from in one click. Storage and the reasoning are in
// migration 0177; the apply rule (**replace**, not merge) is `applyTaxonomyCombo`
// in `@/lib/journal`.
//
// Route-local rather than registered — nothing outside My Journal renders this.
// The pieces it is made of (CollapsibleCard, Button, TokenPicker, TreeIcon) all
// come from the registry, and `TokenPicker` is deliberately the same control the
// entry editor uses for these two fields, so building a combo feels like tagging
// an entry.
//
// No logic here: what a valid combo is, and what applying one does, both come
// from `@/lib/journal`.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { TokenPicker } from "@/components/token-picker";
import { TreeIcon } from "@/components/tree-icons";
import { describeTaxonomyCombo, type JournalTaxonomyCombo } from "@/lib/journal";
import { deleteTaxonomyComboAction, saveTaxonomyComboAction } from "./journal-combo-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// --- The editor --------------------------------------------------------------

/**
 * Builds or edits one combo.
 *
 * Unlike the prefill-template editor next door, the name and description are
 * inline rather than behind a Save dialog: a combo has four fields in total and a
 * second step to collect two of them would be ceremony. The template editor needs
 * its dialog because its field list is unbounded.
 */
function ComboEditor({
  /** The combo being edited, or undefined when adding a new one. */
  combo,
  categoryOptions,
  tagOptions,
  onDone,
  onCancel,
}: {
  combo?: JournalTaxonomyCombo;
  categoryOptions: string[];
  tagOptions: string[];
  onDone: () => void;
  /** Omitted on the always-open "Add New Combo" card — there is nothing to close. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(combo?.name ?? "");
  const [description, setDescription] = useState(combo?.description ?? "");
  const [categories, setCategories] = useState<string[]>(combo?.categories ?? []);
  const [tags, setTags] = useState<string[]>(combo?.tags ?? []);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  function clear() {
    setName("");
    setDescription("");
    setCategories([]);
    setTags([]);
    setError(undefined);
  }

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await saveTaxonomyComboAction({
        id: combo?.id,
        name,
        description,
        categories,
        tags,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Adding leaves the card ready for the next one; editing closes the panel.
      if (!combo) clear();
      onDone();
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const isEmpty = categories.length === 0 && tags.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Pick the categories and tags this combo should apply. Type a name that isn&rsquo;t in
        either list to add it — exactly as on the entry screen. A new name is registered when
        you first save an entry carrying it, not when you save the combo.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* One column on a phone, two from `sm` up — the same grid the entry
          editor puts these two controls in, so the pair reads the same way in
          both places. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TokenPicker
          label="Categories"
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          allowCreate
          createPlaceholder="Filter or add a category…"
        />
        <TokenPicker
          label="Tags"
          value={tags}
          onChange={setTags}
          options={tagOptions}
          allowCreate
          createPlaceholder="Filter or add a tag…"
        />

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Gym session"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="When to reach for this one."
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {isEmpty && (
        <p className="text-xs text-muted">
          This combo names nothing, so applying it will <strong>clear</strong> an entry&rsquo;s
          categories and tags. That is allowed — save it if that is what you want.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isBusy || name.trim() === ""}>
          {isBusy ? "Saving…" : combo ? "Save the combo" : "Save the new combo"}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// --- The tab -----------------------------------------------------------------

export function JournalTaxonomyCombosView({
  combos,
  categoryOptions,
  tagOptions,
}: {
  combos: JournalTaxonomyCombo[];
  /** The managed category names, for the picker. Read on the server. */
  categoryOptions: string[];
  tagOptions: string[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const editing = combos.find((combo) => combo.id === editingId);

  async function handleDelete(combo: JournalTaxonomyCombo) {
    // A combo is copied onto an entry at apply-time and nothing links back, so
    // this only ever loses the combo itself — a plain confirm is enough.
    if (!window.confirm(`Delete the combo "${combo.name}"?`)) return;
    setBusyId(combo.id);
    setError(undefined);
    try {
      const result = await deleteTaxonomyComboAction(combo.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        A combo is a named set of categories and tags. Pick one from{" "}
        <strong>Prefill Category/Tags Combo</strong> on the New Entry screen, or in an existing
        entry&rsquo;s editor, and it <strong>replaces</strong> both fields with the combo&rsquo;s
        selection — unlike a prefill template, which only fills blanks.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {combos.length === 0 ? (
        <p className="text-sm text-muted">No combos yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {combos.map((combo) => (
            <li
              key={combo.id}
              className="flex flex-wrap items-start gap-3 rounded-lg border border-line p-3"
            >
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === combo.id ? undefined : combo.id)}
                  aria-label={`Edit the combo "${combo.name}"`}
                  title="Edit"
                  className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <TreeIcon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(combo)}
                  disabled={busyId === combo.id}
                  aria-label={`Delete the combo "${combo.name}"`}
                  title="Delete"
                  className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{combo.name}</p>
                {combo.description !== "" && (
                  <p className="mt-0.5 text-sm text-muted">{combo.description}</p>
                )}
                {/* The same sentence the CLI prints — see describeTaxonomyCombo
                    on why that summary lives in lib rather than here. */}
                <p className="mt-1 text-xs text-muted">{describeTaxonomyCombo(combo)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CollapsibleCard title={`Edit “${editing.name}”`} defaultOpen>
          <ComboEditor
            // Remounts when a different combo is picked, so the editor's chips
            // reload rather than carrying the previous one's.
            key={editing.id}
            combo={editing}
            categoryOptions={categoryOptions}
            tagOptions={tagOptions}
            onDone={() => setEditingId(undefined)}
            onCancel={() => setEditingId(undefined)}
          />
        </CollapsibleCard>
      )}

      <CollapsibleCard title="Add New Combo" defaultOpen>
        <ComboEditor
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          onDone={() => undefined}
        />
      </CollapsibleCard>
    </div>
  );
}
