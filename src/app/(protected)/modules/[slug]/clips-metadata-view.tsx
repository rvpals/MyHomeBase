"use client";

// Categories & Tags: the two managed lists a clip is filed under.
//
// Two lists, not one, mirroring the Journal — a category says what KIND of thing a
// clip is, a tag says what it is ABOUT.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { ClipTaxonomyItem } from "@/lib/clips";
import {
  deleteClipCategoryAction,
  deleteClipTagAction,
  saveClipCategoryAction,
  saveClipTagAction,
} from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ClipsMetadataView({
  categories,
  tags,
}: {
  categories: ClipTaxonomyItem[];
  tags: ClipTaxonomyItem[];
}) {
  return (
    <div className="space-y-4">
      <CollapsibleCard title="Categories">
        <TaxonomyList
          items={categories}
          noun="category"
          onSave={saveClipCategoryAction}
          onDelete={deleteClipCategoryAction}
        />
      </CollapsibleCard>

      <CollapsibleCard title="Tags">
        <TaxonomyList
          items={tags}
          noun="tag"
          onSave={saveClipTagAction}
          onDelete={deleteClipTagAction}
        />
      </CollapsibleCard>
    </div>
  );
}

function TaxonomyList({
  items,
  noun,
  onSave,
  onDelete,
}: {
  items: ClipTaxonomyItem[];
  noun: string;
  onSave: (name: string, description: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (name: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function handleAdd() {
    const result = await onSave(name, description);
    if (!result.ok) {
      setError(result.error ?? `Could not save that ${noun}.`);
      return;
    }
    setName("");
    setDescription("");
    setError("");
    router.refresh();
  }

  async function handleDelete(itemName: string, usageCount: number) {
    // Said with the number rather than a bare "are you sure": deleting a name in
    // use strips it off every clip carrying it, and the count is what makes that
    // consequence visible before the fact.
    const warning =
      usageCount > 0
        ? `Delete "${itemName}"? It is on ${usageCount} clip${usageCount === 1 ? "" : "s"}, and will be removed from ${usageCount === 1 ? "it" : "them"}.`
        : `Delete "${itemName}"?`;
    if (!confirm(warning)) return;

    const result = await onDelete(itemName);
    if (!result.ok) {
      setError(result.error ?? `Could not delete that ${noun}.`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm text-ink">{item.name}</p>
                {item.description && <p className="text-xs text-muted">{item.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{item.usageCount}</span>
                <Button variant="danger" onClick={() => handleDelete(item.name, item.usageCount)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 lg:grid-cols-[1fr_2fr_auto]">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`New ${noun}`}
          className={INPUT_CLASS}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          className={INPUT_CLASS}
        />
        <Button variant="primary" onClick={handleAdd}>
          Add
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
