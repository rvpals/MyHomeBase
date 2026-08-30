"use client";

// The "My favorites" list behind the random photo card's heart button.
//
// A one-off home-screen dialog, not a registered component, for the same reason
// random-photo-widget.tsx is one: it exists to serve that card and nothing else asks
// for a list of favourite photographs. If a second caller ever appears, this is the
// moment to promote it — not before.

import { useCallback, useState } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { TreeIcon } from "@/components/tree-icons";
import type { FavPhoto } from "@/lib/fav-photos";
import {
  listFavPhotosAction,
  removeFavPhotoAction,
  setFavPhotoNoteAction,
} from "./random-photo-actions";

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

/** The file name, for the caption column. */
function fileNameOf(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

/** The folder it came from, for the dimmer second line. */
function folderOf(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments.slice(0, -1).join(" / ");
}

/**
 * One row's note, editable in place.
 *
 * A local draft rather than writing on every keystroke: a server action per character
 * would be a write storm over an SMB-backed app, and an input whose value round-trips
 * to the server loses the caret. The draft is committed on blur and on Enter, which is
 * what a table cell that looks like a text field is expected to do.
 *
 * Keyed by path at the call site, so switching rows remounts with a fresh draft rather
 * than carrying the previous row's text over.
 */
function NoteCell({
  favorite,
  onSave,
}: {
  favorite: FavPhoto;
  onSave: (relativePath: string, note: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(favorite.note);
  const [isSaving, setIsSaving] = useState(false);

  async function commit() {
    // Nothing changed — don't spend a round trip on a click-through.
    if (draft === favorite.note) return;
    setIsSaving(true);
    try {
      await onSave(favorite.relativePath, draft);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        // Escape abandons the edit rather than closing the dialog underneath it.
        if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(favorite.note);
        }
      }}
      // A click in the note must not also open the lightbox — the row is clickable.
      onClick={(event) => event.stopPropagation()}
      disabled={isSaving}
      maxLength={500}
      placeholder="Add a note…"
      aria-label={`Note for ${fileNameOf(favorite.relativePath)}`}
      className="w-full rounded border border-line bg-paper px-2 py-1 text-sm text-ink placeholder:text-muted focus:border-brass-dark focus:outline-none disabled:opacity-50"
    />
  );
}

export function FavPhotosDialog({
  initialFavorites,
  onClose,
  onChanged,
}: {
  /** The list as the card last read it, so the dialog opens with content. */
  initialFavorites: FavPhoto[];
  onClose: () => void;
  /**
   * Raised after any write, with the fresh list.
   *
   * The card owns whether the *currently shown* photo is favourited, and removing it
   * from this list has to un-fill its heart. Handing back the whole list rather than a
   * "something changed" ping means the card re-derives that without a second read.
   */
  onChanged: (favorites: FavPhoto[]) => void;
}) {
  const [favorites, setFavorites] = useState(initialFavorites);
  const [error, setError] = useState<string | undefined>(undefined);
  // An out-of-range index renders nothing, so one number means "closed" — the contract
  // PhotoLightbox documents.
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Re-reads after every write, rather than patching the row locally. The list is
  // small and this is one round trip on an action the reader just took, which buys
  // correctness when the same person has the app open on their phone as well.
  const refresh = useCallback(async () => {
    const fresh = await listFavPhotosAction();
    setFavorites(fresh);
    onChanged(fresh);
    return fresh;
  }, [onChanged]);

  const handleSaveNote = useCallback(
    async (relativePath: string, note: string) => {
      setError(undefined);
      try {
        const written = await setFavPhotoNoteAction(relativePath, note);
        if (!written) {
          // The row went away between opening the dialog and this blur.
          setError("That photo is no longer a favourite, so the note wasn't saved.");
        }
        await refresh();
      } catch {
        setError("Couldn't save the note.");
      }
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (relativePath: string) => {
      setError(undefined);
      try {
        await removeFavPhotoAction(relativePath);
        await refresh();
      } catch {
        setError("Couldn't remove that favourite.");
      }
    },
    [refresh],
  );

  // A removal can leave the lightbox pointing past the end of a now-shorter list.
  // Clamped during render rather than corrected in an effect: an effect would paint one
  // frame of the wrong photo first, and `PhotoLightbox` already treats an out-of-range
  // index as "show nothing", so closing it is a matter of not rendering it.
  const openIndex = lightboxIndex < favorites.length ? lightboxIndex : -1;

  const columns: DataGridColumn<FavPhoto>[] = [
    {
      key: "thumbnail",
      header: "Photo",
      // No `value`: an image sorts, searches and exports as nothing useful. The name
      // column carries the sortable text for this row.
      render: (row) => (
        /* eslint-disable-next-line @next/next/no-img-element -- the bytes come from our
           own session-guarded route over an SMB share, not a static asset next/image
           can optimize. */
        <img
          src={photoUrl(row.relativePath)}
          alt=""
          loading="lazy"
          className="h-16 w-16 rounded object-cover max-lg:h-12 max-lg:w-12"
        />
      ),
      className: "w-24 max-lg:w-16",
    },
    {
      key: "photo",
      header: "Photo name",
      value: (row) => row.relativePath,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{fileNameOf(row.relativePath)}</div>
          <div className="truncate text-xs text-muted">{folderOf(row.relativePath)}</div>
        </div>
      ),
    },
    {
      key: "note",
      header: "Note",
      value: (row) => row.note,
      // Keyed by path so a re-ordered or re-read list gives each row its own draft
      // rather than reusing the one mounted at that position.
      render: (row) => <NoteCell key={row.relativePath} favorite={row} onSave={handleSaveNote} />,
    },
    {
      key: "createdAt",
      header: "Added",
      value: (row) => row.createdAt,
      render: (row) => <span className="text-sm text-muted">{row.createdAt}</span>,
    },
    {
      key: "actions",
      header: "",
      excludeFromRecordView: true,
      // The wrapper, not the Button, stops the click: `Button`'s `onClick` takes no
      // event, and the row underneath is clickable — without this, removing a
      // favourite would also open the lightbox on the row being deleted.
      render: (row) => (
        <span
          onClick={(event) => event.stopPropagation()}
          role="presentation"
          className="inline-flex"
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleRemove(row.relativePath)}
            title="Remove from favorites"
            ariaLabel={`Remove ${fileNameOf(row.relativePath)} from favorites`}
          >
            <TreeIcon name="trash" className="h-4 w-4" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Modal title="My favorite photos" size="lg" onClose={onClose}>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <DataGrid
        columns={columns}
        rows={favorites}
        getRowKey={(row) => row.relativePath}
        emptyMessage="No favourite photos yet — press the heart on the random photo card to keep one."
        exportFileName="favorite-photos"
        storageKey="home:fav-photos"
        // Clicking a row opens the photo. The note field and the remove button stop
        // their own clicks from reaching it, so each control does one thing.
        onRowClick={(row) =>
          setLightboxIndex(favorites.findIndex((one) => one.relativePath === row.relativePath))
        }
      />

      {/* The lightbox walks the whole favourites list, not just the row clicked, so
          prev/next browses what was kept. */}
      {openIndex >= 0 && (
        <PhotoLightbox
          photos={favorites.map((favorite) => ({
            src: photoUrl(favorite.relativePath),
            // The note is the better caption when there is one — it is what the reader
            // wrote about the picture. The file name is the fallback, not the headline.
            caption: favorite.note !== "" ? favorite.note : fileNameOf(favorite.relativePath),
            subcaption: folderOf(favorite.relativePath),
          }))}
          index={openIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(-1)}
        />
      )}
    </Modal>
  );
}
