"use client";

// Categories & Tags editor for the Journal's Location Meta Data section. Two
// managed lists with an inline "New" form and edit/delete row actions.
//
// Modelled on journal-taxonomy-view.tsx (the entry-side editor) minus all of its
// icon machinery. A place's mark on the map is its pin, so a second per-category
// glyph would compete with it — see migration 0101.
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import type { LocationTaxonomyKind } from "@/lib/journal-locations";
import {
  deleteLocationTaxonomyAction,
  saveLocationTaxonomyAction,
} from "./journal-locations-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One row of either list — the two have exactly this shape. */
export interface LocationTaxonomyItem {
  name: string;
  description: string;
  /** How many saved places carry this name. */
  count: number;
}

/** The popup opened by a row's Edit button. Only the description is editable —
 *  the name is the key the pairings carry, so renaming is a delete-and-recreate. */
function EditLocationTaxonomyModal({
  kind,
  item,
  onClose,
}: {
  kind: LocationTaxonomyKind;
  item: LocationTaxonomyItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(item.description);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await saveLocationTaxonomyAction(kind, { name: item.name, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`Edit ${kind} "${item.name}"`}>
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <p className="text-xs text-muted">
          Used by {item.count} saved {item.count === 1 ? "place" : "places"}.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isBusy}>
            {isBusy ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LocationTaxonomyList({
  kind,
  title,
  helpText,
  items,
}: {
  kind: LocationTaxonomyKind;
  title: string;
  helpText: string;
  items: LocationTaxonomyItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<LocationTaxonomyItem | undefined>(undefined);

  async function handleCreate() {
    setError(undefined);
    const result = await saveLocationTaxonomyAction(kind, { name, description });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setDescription("");
    router.refresh();
  }

  async function handleDelete(item: LocationTaxonomyItem) {
    // The count is in the prompt because it is the whole cost of the action:
    // the places survive, but every pairing goes.
    const used =
      item.count === 0
        ? ""
        : ` ${item.count} saved ${item.count === 1 ? "place loses" : "places lose"} it.`;
    if (!window.confirm(`Delete "${item.name}"?${used}`)) return;
    const result = await deleteLocationTaxonomyAction(kind, item.name);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <p className="text-sm text-muted">{helpText}</p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div>
        <Button size="sm" onClick={handleCreate} disabled={name.trim() === ""}>
          Add {kind}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.name}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              {/* Actions lead the row, icon-only, each with an aria-label and a
                  title since the glyph is the whole control. Row actions stay
                  hand-drawn — no icon slot (coding-guide.md). */}
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  aria-label={`Edit ${kind} "${item.name}"`}
                  title="Edit"
                  className="text-muted hover:text-brass"
                >
                  <TreeIcon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete ${kind} "${item.name}"`}
                  title="Delete"
                  className="text-muted hover:text-red-400"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </span>
              <span className="font-medium text-ink">{item.name}</span>
              {item.description && <span className="text-muted">{item.description}</span>}
              <span className="ml-auto shrink-0 font-mono text-xs text-muted">
                {item.count}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditLocationTaxonomyModal
          kind={kind}
          item={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

export function JournalLocationTaxonomyView({
  categories,
  tags,
}: {
  categories: LocationTaxonomyItem[];
  tags: LocationTaxonomyItem[];
}) {
  return (
    // One column on a phone, two side by side from `lg` up. A `max-lg:` restyle
    // isn't available here — the desktop default *is* two columns — so this is
    // the plain mobile-first form of the same rule (design.md → Phone and desktop).
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <LocationTaxonomyList
        kind="category"
        title="Location categories"
        helpText="What a place is — Restaurant, Trailhead, Family. Separate from your entry categories, which say what the writing is about."
        items={categories}
      />
      <LocationTaxonomyList
        kind="tag"
        title="Location tags"
        helpText="Anything else you want to group places by."
        items={tags}
      />
    </div>
  );
}
