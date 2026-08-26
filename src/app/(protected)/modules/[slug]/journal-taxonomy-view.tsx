"use client";

// Categories & Tags editor for My Journal's Meta Data section. Lists both managed
// lists with an inline "New" form, and edit/generate/delete icon buttons leading
// each row. Edit opens a popup (Modal) for changing the description and
// uploading/removing a small icon — the icon control is the one thing that
// doesn't fit inline, since dropping a file needs room the row doesn't have.
//
// The ⚡ row action draws an icon from the item's *name*: the name is mapped to a
// Material Design Icons glyph (@/lib/journal/icon-search) and the bytes fetched
// once and stored (@/lib/journal/icon-fetch), falling back to a locally drawn
// glyph when offline or unmapped. There are also two bulk fills, because a real
// journal runs to a couple of hundred tags and none of them start with an icon:
// "draw the missing icons" at the top covers both lists, and "Autopopulate icon
// for <kind>" beside each list's Add button covers just that list. Both are
// missing-only — the row action is how you redo a single one you don't like.
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
  generateJournalCategoryIconAction,
  generateJournalTagIconAction,
  generateMissingJournalIconsAction,
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

const generateIconAction = (kind: Kind) =>
  kind === "category" ? generateJournalCategoryIconAction : generateJournalTagIconAction;

/**
 * Asks the server to draw an icon for `item` from its name, confirming first when
 * that would overwrite one it already has.
 *
 * The confirm is conditional on purpose: generating onto an empty slot is
 * trivially undoable (generate again, or upload), but an icon the reader chose and
 * uploaded is not recoverable, so a mis-click on a crowded row mustn't destroy it.
 *
 * Returns the error message to show, or undefined when it worked or was cancelled.
 */
async function generateIconFor(
  kind: Kind,
  item: TaxonomyItem,
): Promise<{ error?: string; cancelled?: boolean }> {
  if (
    item.iconMimeType &&
    !window.confirm(`Replace the existing icon for "${item.name}" with a generated one?`)
  ) {
    return { cancelled: true };
  }
  const result = await generateIconAction(kind)(item.name);
  return result.ok ? {} : { error: result.error };
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

  // The same generate action as the row's flash button. Offered here too because
  // this popup is where someone lands to *fix* an icon, and "draw me one" belongs
  // beside "upload one" rather than only out on the row.
  async function handleGenerateIcon() {
    setError(undefined);
    setIsBusy(true);
    try {
      const { error: message, cancelled } = await generateIconFor(kind, item);
      if (cancelled) return;
      if (message) setError(message);
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
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={handleGenerateIcon} disabled={isBusy}>
              Generate from name
            </Button>
            {item.iconMimeType && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleRemoveIcon}
                className="text-xs text-muted hover:text-red-400"
              >
                Remove icon
              </button>
            )}
          </div>
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
  // Which row is mid-generate, by name — one row's spinner must not disable the
  // whole list, so this is a name rather than a boolean.
  const [generating, setGenerating] = useState<string | undefined>(undefined);

  // The batch fill for this list only — its own busy flag and its own result
  // line, so it never borrows the per-row spinner.
  const [autopopulating, setAutopopulating] = useState(false);
  const [autopopulateResult, setAutopopulateResult] = useState<string | undefined>(undefined);

  const saveAction = kind === "category" ? saveJournalCategoryAction : saveJournalTagAction;
  const deleteAction = kind === "category" ? deleteJournalCategoryAction : deleteJournalTagAction;
  const missingIcons = items.filter((item) => !item.iconMimeType).length;

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

  async function handleGenerate(item: JournalCategory | JournalTag) {
    setError(undefined);
    setGenerating(item.name);
    try {
      const { error: message, cancelled } = await generateIconFor(kind, item);
      if (cancelled) return;
      if (message) setError(message);
      else router.refresh();
    } finally {
      setGenerating(undefined);
    }
  }

  /**
   * Draws an icon for every row in *this* list that hasn't got one. Missing-only,
   * so a hand-uploaded icon is never replaced by surprise — the per-row flash
   * button stays the way to overwrite one.
   */
  async function handleAutopopulate() {
    setError(undefined);
    setAutopopulateResult(undefined);
    setAutopopulating(true);
    try {
      const outcome = await generateMissingJournalIconsAction(kind);
      if (!outcome.ok) {
        setError(outcome.error ?? "Failed to generate the missing icons.");
        return;
      }
      const failed = outcome.failed ?? 0;
      setAutopopulateResult(
        `Drew ${outcome.generated ?? 0} icon${outcome.generated === 1 ? "" : "s"}` +
          (failed > 0 ? `, ${failed} could not be drawn.` : "."),
      );
      router.refresh();
    } finally {
      setAutopopulating(false);
    }
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

      {/* Both buttons on one wrapping row: adding one by hand and filling in the
          blanks for the whole list are the two things you do from here. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleCreate} disabled={name.trim() === ""}>
          Add {kind === "category" ? "category" : "tag"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleAutopopulate}
          disabled={autopopulating || missingIcons === 0}
          title={
            missingIcons === 0
              ? `Every ${kind} already has an icon`
              : `Draw an icon for the ${missingIcons} with none yet, leaving existing icons alone`
          }
        >
          {autopopulating ? "Drawing…" : `Autopopulate icon for ${kind}`}
        </Button>
        {autopopulateResult && <span className="text-sm text-muted">{autopopulateResult}</span>}
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
                {/* Generate an icon from the name. Sits between edit and delete
                    because it edits the row rather than destroying it — and it
                    stays enabled on rows that already have an icon, since
                    replacing one is a reason to press it. */}
                <button
                  type="button"
                  onClick={() => handleGenerate(item)}
                  disabled={generating === item.name}
                  aria-label={`Generate an icon for ${kind} "${item.name}"`}
                  title={
                    item.iconMimeType
                      ? "Generate an icon from the name (replaces the current one)"
                      : "Generate an icon from the name"
                  }
                  className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40"
                >
                  <TreeIcon
                    name="flash"
                    className={`h-4 w-4 ${generating === item.name ? "animate-pulse" : ""}`}
                  />
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

/**
 * "Fill in the missing icons" — one click for every category and tag that hasn't
 * got one.
 *
 * Worth its own control because the per-row button doesn't scale: a real journal
 * runs to a couple of hundred tags and none of them start with an icon. Only
 * fills blanks, so a hand-uploaded icon is never replaced by surprise.
 */
function GenerateAllIconsButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);

  async function handleClick() {
    setResult(undefined);
    setIsBusy(true);
    try {
      const outcome = await generateMissingJournalIconsAction();
      if (!outcome.ok) {
        setResult(outcome.error ?? "Failed to generate the missing icons.");
        return;
      }
      const failed = outcome.failed ?? 0;
      setResult(
        `Drew ${outcome.generated ?? 0} icon${outcome.generated === 1 ? "" : "s"}` +
          (failed > 0 ? `, ${failed} could not be drawn.` : "."),
      );
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  if (missing === 0 && result === undefined) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
      <TreeIcon name="flash" className="h-5 w-5 shrink-0 text-brass-dark" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        {missing > 0
          ? `${missing} categor${missing === 1 ? "y" : "ies"} and tags have no icon yet.`
          : "Every category and tag has an icon."}
        {result && <span className="ml-2 text-muted">{result}</span>}
      </p>
      {missing > 0 && (
        <Button size="sm" onClick={handleClick} disabled={isBusy}>
          {isBusy ? "Drawing…" : "Draw the missing icons"}
        </Button>
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
  const missing = [...categories, ...tags].filter((item) => !item.iconMimeType).length;

  return (
    <div className="flex flex-col gap-8">
      <GenerateAllIconsButton missing={missing} />
      <TaxonomyPanel
        kind="category"
        title="Categories"
        helpText="Categories are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the category appears. The ⚡ button draws an icon from the name."
        items={categories}
      />
      <TaxonomyPanel
        kind="tag"
        title="Tags"
        helpText="Tags are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the tag appears. The ⚡ button draws an icon from the name."
        items={tags}
      />
    </div>
  );
}
