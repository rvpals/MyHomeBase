"use client";

// Categories & Tags: the two managed vocabularies behind the home screen's chips.
//
// Two lists of the same shape, so one component draws both and the screen renders
// it twice. The alternative — a Categories component and a near-identical Tags
// component — is how two lists drift into behaving differently.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { SnippetTaxonomyItem } from "@/lib/code-library";
import {
  deleteCategoryAction,
  deleteTagAction,
  saveCategoryAction,
  saveTagAction,
} from "./code-library-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

type Kind = "category" | "tag";

export function CodeLibraryMetadataView({
  categories,
  tags,
}: {
  categories: SnippetTaxonomyItem[];
  tags: SnippetTaxonomyItem[];
}) {
  return (
    // Side by side on a desktop, stacked on a phone. Two columns of chips at
    // phone width would give each about 20 characters.
    <div className="grid gap-6 lg:grid-cols-2">
      <TaxonomyList kind="category" title="Categories" items={categories} />
      <TaxonomyList kind="tag" title="Tags" items={tags} />
    </div>
  );
}

function TaxonomyList({
  kind,
  title,
  items,
}: {
  kind: Kind;
  title: string;
  items: SnippetTaxonomyItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The row being renamed, by its *current* name — which is also the key the
  // rename has to send as `previousName`.
  const [editing, setEditing] = useState("");
  const [draftName, setDraftName] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  const save = kind === "category" ? saveCategoryAction : saveTagAction;
  const remove = kind === "category" ? deleteCategoryAction : deleteTagAction;
  const noun = kind === "category" ? "category" : "tag";

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setIsBusy(true);
    setError("");
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? `Could not save that ${noun}.`);
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleAdd() {
    // `previousName` blank: this is a new entry, not a rename.
    const ok = await run(() => save({ name, description, previousName: "" }));
    if (!ok) return;
    setName("");
    setDescription("");
  }

  async function handleRename(previousName: string) {
    const ok = await run(() =>
      save({ name: draftName, description: "", previousName }),
    );
    if (!ok) return;
    setEditing("");
  }

  async function handleDelete(item: SnippetTaxonomyItem) {
    // Named numbers rather than "are you sure": deleting a word in use unfiles
    // every snippet carrying it, and the count is the only thing that makes that
    // consequence visible before it happens.
    const warning =
      item.usageCount > 0
        ? `Delete the ${noun} "${item.name}"? ${item.usageCount} snippet${
            item.usageCount === 1 ? "" : "s"
          } will lose this label. The snippets themselves are kept.`
        : `Delete the ${noun} "${item.name}"?`;
    if (!confirm(warning)) return;
    await run(() => remove(item.name));
  }

  return (
    <section className="rounded-xl border border-line bg-paper-raised p-4">
      <h2 className="font-display text-lg text-ink">{title}</h2>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={name}
          placeholder={`New ${noun}`}
          onChange={(event) => setName(event.target.value)}
          className={INPUT_CLASS}
        />
        <input
          type="text"
          value={description}
          placeholder="Description (optional)"
          onChange={(event) => setDescription(event.target.value)}
          className={INPUT_CLASS}
        />
        <Button size="sm" onClick={() => void handleAdd()} disabled={isBusy || name.trim() === ""}>
          Add
        </Button>
      </div>

      {error !== "" && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No {noun}s yet. One is also created whenever you type it on a snippet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.name}
              className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0"
            >
              {editing === item.name ? (
                <>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    className={`${INPUT_CLASS} flex-1`}
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleRename(item.name)}
                    disabled={isBusy || draftName.trim() === ""}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing("")}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink">
                    {item.name}
                    {item.description !== "" && (
                      <span className="ml-2 text-xs text-muted">{item.description}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {item.usageCount} {item.usageCount === 1 ? "snippet" : "snippets"}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(item.name);
                      setDraftName(item.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleDelete(item)}
                    disabled={isBusy}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
