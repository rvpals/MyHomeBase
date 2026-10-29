"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FileDropzone } from "@/components/file-dropzone";
import { TaxonomyIcon } from "@/components/taxonomy-icon";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import type { DocumentTaxonomyItem } from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import {
  clearCategoryIconAction,
  clearTagIconAction,
  deleteCategoryAction,
  deleteTagAction,
  saveCategoryAction,
  saveCategoryIconAction,
  saveTagAction,
  saveTagIconAction,
} from "./documents-actions";

// Documents → Categories & Tags. The two lists a document is filed under, each row
// carrying its own icon picker — the same treatment the Journal's and Expense's
// taxonomy screens give theirs.
//
// One component rendered twice rather than two near-identical ones: the lists have the
// same shape and the same operations, and the only difference is which set of actions
// they call. Narrow: each list is a single column already, and the add row wraps.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

type Kind = "category" | "tag";

/** Reads a File as bare base64 (no data-URL prefix), which the action wants. */
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
 * Where an item's icon is served from, or `undefined` when it has none.
 *
 * `?v=` is a cache-buster keyed on `updatedAt`: the route sends
 * `Cache-Control: private, max-age=300`, so without it a replaced icon would keep
 * showing the old picture for five minutes. The name is encoded because it *is* the
 * key and may hold a space or a slash.
 */
function iconUrl(kind: Kind, item: DocumentTaxonomyItem): string | undefined {
  if (!item.hasIcon) return undefined;
  const segment = kind === "category" ? "categories" : "tags";
  return `/api/documents/${segment}/${encodeURIComponent(item.name)}/icon?v=${encodeURIComponent(item.updatedAt)}`;
}

export function DocumentsMetadataView({
  categories,
  tags,
}: {
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
}) {
  return (
    <div className={PAGE_CONTAINER}>
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <CollapsibleCard title="Categories" defaultOpen>
          <TaxonomyList
            items={categories}
            kind="category"
            onSave={saveCategoryAction}
            onDelete={deleteCategoryAction}
            onSaveIcon={saveCategoryIconAction}
            onClearIcon={clearCategoryIconAction}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Tags" defaultOpen>
          <TaxonomyList
            items={tags}
            kind="tag"
            onSave={saveTagAction}
            onDelete={deleteTagAction}
            onSaveIcon={saveTagIconAction}
            onClearIcon={clearTagIconAction}
          />
        </CollapsibleCard>
      </div>
    </div>
  );
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

function TaxonomyList({
  items,
  kind,
  onSave,
  onDelete,
  onSaveIcon,
  onClearIcon,
}: {
  items: DocumentTaxonomyItem[];
  kind: Kind;
  onSave: (name: string, description: string) => Promise<ActionResult>;
  onDelete: (name: string) => Promise<ActionResult>;
  onSaveIcon: (name: string, mimeType: string, base64Data: string) => Promise<ActionResult>;
  onClearIcon: (name: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  // Which row has its picker open. One at a time: the picker is three controls tall,
  // and every row showing one would bury the list it is meant to annotate.
  const [editingIcon, setEditingIcon] = useState<string>();

  function run(work: () => Promise<ActionResult>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? `Could not save that ${kind}.`);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  async function handleIconFile(itemName: string, file: File) {
    setError(undefined);
    let base64Data: string;
    try {
      base64Data = await readFileAsBase64(file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that image.");
      return;
    }
    // The read happens outside the transition because it is async work the transition
    // cannot track; only the action goes inside it.
    run(() => onSaveIcon(itemName, file.type, base64Data), () => setEditingIcon(undefined));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 max-lg:flex-col">
        <input
          className={`${INPUT_CLASS} flex-1`}
          value={name}
          placeholder={`New ${kind}`}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className={`${INPUT_CLASS} flex-1`}
          value={description}
          placeholder="Description (optional)"
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={isPending || name.trim() === ""}
          onClick={() =>
            run(
              () => onSave(name, description),
              () => {
                setName("");
                setDescription("");
              },
            )
          }
        >
          Add
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">No {kind} yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const url = iconUrl(kind, item);
            const isEditing = editingIcon === item.name;

            return (
              <li
                key={item.name}
                className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {url ? (
                      <TaxonomyIcon url={url} name={item.name} size="sm" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 rounded border border-dashed border-line"
                      />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-ink">{item.name}</span>
                      {item.description !== "" && (
                        <span className="truncate text-xs text-muted">{item.description}</span>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      ariaLabel={`${item.hasIcon ? "Change" : "Add"} the icon for ${item.name}`}
                      title={`${item.hasIcon ? "Change" : "Add"} icon`}
                      ariaExpanded={isEditing}
                      onClick={() => setEditingIcon(isEditing ? undefined : item.name)}
                    >
                      Icon
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      ariaLabel={`Delete ${item.name}`}
                      title={`Delete ${item.name} — documents filed under it are not deleted`}
                      onClick={() => {
                        // Said in full, because "delete" next to a list of documents
                        // reads as though it might take them with it. It does not.
                        const ok = window.confirm(
                          `Delete the ${kind} “${item.name}”?\n\n` +
                            "No documents are deleted — they simply stop being filed under it.",
                        );
                        if (ok) run(() => onDelete(item.name));
                      }}
                    >
                      ×
                    </Button>
                  </span>
                </div>

                {isEditing && (
                  <div className="flex flex-col gap-2 border-t border-line pt-2">
                    <FileDropzone
                      accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                      disabled={isPending}
                      label={
                        item.hasIcon
                          ? "Drop a new icon here, or click to browse"
                          : "Drop an icon here, or click to browse"
                      }
                      onFile={(file) => handleIconFile(item.name, file)}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted">
                        PNG, JPEG, WebP or GIF, up to 128 KB. It is shown at about 20px,
                        so a simple glyph reads better than a photograph.
                      </span>
                      {item.hasIcon && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            run(() => onClearIcon(item.name), () => setEditingIcon(undefined))
                          }
                          className="text-xs text-muted hover:text-red-400"
                        >
                          Remove icon
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
