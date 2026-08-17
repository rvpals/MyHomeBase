"use client";

// Categories & Tags editor for My Journal's Configuration section. Lists both
// managed lists with an inline "New" form, and edit/delete icon buttons leading
// each row. Edit opens a popup (Modal) for changing the description and
// uploading/removing a small icon — the icon control is the one thing that
// doesn't fit inline, since dropping a file needs room the row doesn't have.
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import {
  JOURNAL_IMAGE_MIME_TYPES,
  MAX_JOURNAL_ICON_BYTES,
  type JournalCategory,
  type JournalTag,
} from "@/lib/journal";
import {
  clearJournalCategoryIconAction,
  clearJournalTagIconAction,
  deleteJournalCategoryAction,
  deleteJournalTagAction,
  saveJournalCategoryAction,
  saveJournalCategoryIconAction,
  saveJournalTagAction,
  saveJournalTagIconAction,
} from "./journal-actions";
import {
  TaxonomyIconThumbnail,
  journalEntriesFilterHref,
  journalTaxonomyIconUrl,
} from "./journal-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Either a category or a tag — the two managed lists share this exact shape. */
interface TaxonomyItem {
  name: string;
  description: string;
  iconMimeType?: string;
}

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

/** Where an item's icon is served from, or undefined when it has none. */
function iconUrl(kind: Kind, item: TaxonomyItem, updatedAt: string): string | undefined {
  return journalTaxonomyIconUrl(kind, { ...item, updatedAt });
}

/**
 * The popup opened by a row's Edit button: description field plus icon
 * upload/replace/remove. `updatedAt` is passed in separately from `item`
 * because JournalCategory/JournalTag carry it but this component only needs
 * the taxonomy-item subset for its own fields.
 */
function EditTaxonomyModal({
  kind,
  item,
  updatedAt,
  onClose,
}: {
  kind: Kind;
  item: TaxonomyItem;
  updatedAt: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(item.description);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const saveAction = kind === "category" ? saveJournalCategoryAction : saveJournalTagAction;
  const saveIconAction = kind === "category" ? saveJournalCategoryIconAction : saveJournalTagIconAction;
  const clearIconAction = kind === "category" ? clearJournalCategoryIconAction : clearJournalTagIconAction;

  async function handleSaveDescription() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await saveAction({ name: item.name, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleIconFile(file: File) {
    setError(undefined);
    if (file.size > MAX_JOURNAL_ICON_BYTES) {
      setError(`"${file.name}" is too large — keep it under ${Math.round(MAX_JOURNAL_ICON_BYTES / 1024)} KB.`);
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveIconAction(item.name, file.type, base64Data);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemoveIcon() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await clearIconAction(item.name);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const url = iconUrl(kind, item, updatedAt);

  return (
    <Modal
      title={`Edit ${kind === "category" ? "category" : "tag"}: ${item.name}`}
      onClose={onClose}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Close
          </Button>
          <Button onClick={handleSaveDescription} disabled={isBusy}>
            Save description
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isBusy}
            className={INPUT_CLASS}
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Icon</span>
          <div className="flex items-center gap-3">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
              <img src={url} alt="" className="h-12 w-12 rounded-lg border border-line object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
                None
              </div>
            )}
            <div className="flex-1">
              <FileDropzone
                accept={JOURNAL_IMAGE_MIME_TYPES.join(",")}
                disabled={isBusy}
                label={item.iconMimeType ? "Drop a new icon here, or click to browse" : "Drop an icon here, or click to browse"}
                onFile={handleIconFile}
              />
            </div>
          </div>
          {item.iconMimeType && (
            <button
              type="button"
              disabled={isBusy}
              onClick={handleRemoveIcon}
              className="mt-2 text-xs text-muted hover:text-red-400"
            >
              Remove icon
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function TaxonomyPanel({
  kind,
  title,
  helpText,
  items,
}: {
  kind: Kind;
  title: string;
  helpText: string;
  items: (JournalCategory | JournalTag)[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<JournalCategory | JournalTag | undefined>(undefined);

  const saveAction = kind === "category" ? saveJournalCategoryAction : saveJournalTagAction;
  const deleteAction = kind === "category" ? deleteJournalCategoryAction : deleteJournalTagAction;

  async function handleCreate() {
    setError(undefined);
    const result = await saveAction({ name, description });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setDescription("");
    router.refresh();
  }

  async function handleDelete(item: JournalCategory | JournalTag) {
    if (
      !window.confirm(
        `Delete "${item.name}"? Entries keep their history but lose this ${kind === "category" ? "category" : "tag"}.`,
      )
    )
      return;
    const result = await deleteAction(item.name);
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
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} />
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
          Add {kind === "category" ? "category" : "tag"}
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
              {/* Actions lead the row, icon-only. Each carries an aria-label and
                  a title, since the glyph is the whole control. */}
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  aria-label={`Edit ${kind} "${item.name}"`}
                  title="Edit"
                  className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <TreeIcon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete ${kind} "${item.name}"`}
                  title="Delete"
                  className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </span>
              <TaxonomyIconThumbnail name={item.name} url={iconUrl(kind, item, item.updatedAt)} />
              {/* The name links to the filtered entry list, same as the Top
                  Tags/Categories cards on the home screen. */}
              <Link
                href={journalEntriesFilterHref(kind, item.name)}
                title={`Show entries for "${item.name}"`}
                className="text-ink hover:text-brass-dark hover:underline"
              >
                {item.name}
              </Link>
              {item.description !== "" && <span className="text-xs text-muted">{item.description}</span>}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditTaxonomyModal
          kind={kind}
          item={editing}
          updatedAt={editing.updatedAt}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

export function JournalTaxonomyView({
  categories,
  tags,
}: {
  categories: JournalCategory[];
  tags: JournalTag[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <TaxonomyPanel
        kind="category"
        title="Categories"
        helpText="Categories are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the category appears."
        items={categories}
      />
      <TaxonomyPanel
        kind="tag"
        title="Tags"
        helpText="Tags are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the tag appears."
        items={tags}
      />
    </div>
  );
}
