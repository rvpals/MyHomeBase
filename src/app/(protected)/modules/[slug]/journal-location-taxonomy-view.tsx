"use client";

// Categories & Tags editor for the Journal's Location Meta Data section. Two
// managed lists with an inline "New" form and edit/delete row actions.
//
// Modelled on journal-taxonomy-view.tsx (the entry-side editor), icon machinery
// included. An earlier version deliberately had none, on the grounds that "a
// place's mark on the map is its pin, so a second per-category glyph would
// compete with it". That was reversed in migration 0105: the icon now *becomes*
// the pin's face for a categorised place, so the two are one mark rather than
// two competing ones.
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import { FileDropzone } from "@/components/file-dropzone";
import { MAX_LOCATION_ICON_BYTES, type LocationTaxonomyKind } from "@/lib/journal-locations";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import {
  clearLocationTaxonomyIconAction,
  deleteLocationTaxonomyAction,
  generateLocationTaxonomyIconAction,
  generateMissingLocationIconsAction,
  saveLocationTaxonomyAction,
  saveLocationTaxonomyIconAction,
} from "./journal-locations-actions";
import { locationTaxonomyIconUrl } from "./journal-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One row of either list — the two have exactly this shape. */
export interface LocationTaxonomyItem {
  name: string;
  description: string;
  /** How many saved places carry this name. */
  count: number;
  /** Set only when an icon exists; the bytes come from the icon route. */
  iconMimeType?: string;
  /** Cache-buster for the icon URL, so a replaced icon shows up at once. */
  updatedAt: string;
}

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
 * Asks the server to draw an icon from `item`'s name, confirming first when
 * there's already one to lose. Returns a message to show, or nothing on success.
 */
async function generateIconFor(
  kind: LocationTaxonomyKind,
  item: LocationTaxonomyItem,
): Promise<{ error?: string; cancelled?: boolean }> {
  if (
    item.iconMimeType &&
    !window.confirm(`Replace the existing icon for "${item.name}" with a generated one?`)
  ) {
    return { cancelled: true };
  }
  const result = await generateLocationTaxonomyIconAction(kind, item.name);
  return { error: result.ok ? undefined : (result.error ?? "Failed to generate an icon.") };
}

/**
 * A row's icon, or nothing when it has none.
 *
 * Its own component rather than TaxonomyIconThumbnail from journal-shared: that
 * one takes a prebuilt URL off the *entry* taxonomy, and the two name-spaces are
 * separate tables behind separate routes.
 */
function LocationTaxonomyIconThumbnail({
  kind,
  item,
}: {
  kind: LocationTaxonomyKind;
  item: LocationTaxonomyItem;
}) {
  const url = locationTaxonomyIconUrl(kind, item);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-5 w-5 shrink-0 rounded border border-line object-cover"
    />
  );
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

  // The popup stays open after an icon change: this is where you land to *fix*
  // an icon, and closing on each step would make "upload, look, regenerate" three
  // round trips through the row's Edit button.
  async function handleIconFile(file: File) {
    setError(undefined);
    if (file.size > MAX_LOCATION_ICON_BYTES) {
      setError(
        `"${file.name}" is too large — keep it under ${Math.round(MAX_LOCATION_ICON_BYTES / 1024)} KB.`,
      );
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveLocationTaxonomyIconAction(kind, item.name, file.type, base64Data);
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
      const result = await clearLocationTaxonomyIconAction(kind, item.name);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

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

  const url = locationTaxonomyIconUrl(kind, item);

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
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Icon</span>
          <div className="flex items-center gap-3">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
              <img
                src={url}
                alt=""
                className="h-12 w-12 rounded-lg border border-line object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
                None
              </div>
            )}
            <div className="flex-1">
              <FileDropzone
                accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                disabled={isBusy}
                label={
                  item.iconMimeType
                    ? "Drop a new icon here, or click to browse"
                    : "Drop an icon here, or click to browse"
                }
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
  // Which row is mid-generate, by name — one row's spinner must not disable the
  // whole list, so this is a name rather than a boolean.
  const [generating, setGenerating] = useState<string | undefined>(undefined);

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

  async function handleGenerate(item: LocationTaxonomyItem) {
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
                  className="text-brass-dark hover:text-brass disabled:opacity-40"
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
                  className="text-muted hover:text-red-400"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </span>
              <LocationTaxonomyIconThumbnail kind={kind} item={item} />
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
  const router = useRouter();
  const [isFilling, setIsFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | undefined>(undefined);

  // Both lists at once, because "draw the missing icons" is a single intent —
  // nobody wants to press it twice. Rows that already have an icon are skipped
  // server-side, so this can't clobber a hand-picked one.
  const missing =
    categories.filter((row) => !row.iconMimeType).length +
    tags.filter((row) => !row.iconMimeType).length;

  async function handleFill() {
    setFillNote(undefined);
    setIsFilling(true);
    try {
      const result = await generateMissingLocationIconsAction();
      if (!result.ok) {
        setFillNote(result.error ?? "Failed to fill in the missing icons.");
        return;
      }
      const { generated = 0, failed = 0 } = result.summary ?? {};
      setFillNote(
        failed === 0
          ? `Drew ${generated} ${generated === 1 ? "icon" : "icons"}.`
          : `Drew ${generated}; ${failed} could not be drawn.`,
      );
      router.refresh();
    } finally {
      setIsFilling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {missing > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={handleFill} disabled={isFilling}>
            {isFilling ? "Drawing…" : `Draw the ${missing} missing ${missing === 1 ? "icon" : "icons"}`}
          </Button>
          {fillNote && <span className="text-xs text-muted">{fillNote}</span>}
        </div>
      )}

      {/* One column on a phone, two side by side from `lg` up. A `max-lg:`
          restyle isn't available here — the desktop default *is* two columns —
          so this is the plain mobile-first form of the same rule
          (design.md → Phone and desktop). */}
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
    </div>
  );
}
