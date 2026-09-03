"use client";

// The My Favorite Photos list: the grid, the inline note editor, the lightbox, and the
// two bulk actions.
//
// A one-off home-screen island, not a registered component, for the same reason
// random-photo-widget.tsx is one: nothing else in the app asks for a list of favourite
// photographs. If a second caller ever appears, this is the moment to promote it — not
// before.
//
// This was the body of a dialog opened from the Random Photo card. It became its own
// screen (`/favorite-photos`) once it grew bulk actions: selecting rows, downloading a
// zip and deleting several favourites is work, and work wants a page with a URL and a
// back button rather than an overlay you might dismiss halfway through. The card's
// button now navigates here.

import { useCallback, useState } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { TreeIcon } from "@/components/tree-icons";
import type { FavPhoto } from "@/lib/fav-photos";
import {
  listFavPhotosAction,
  removeFavPhotosAction,
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
        // Escape abandons the edit rather than bubbling anywhere.
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

export function FavPhotosList({
  initialFavorites,
  onChanged,
}: {
  /** The list as the server read it for this page load, so the screen opens with content. */
  initialFavorites: FavPhoto[];
  /**
   * Raised after any write, with the fresh list.
   *
   * Optional because the page has nobody to tell — it IS the list. The Random Photo
   * card used to need this to un-fill its heart when the shown photo was removed here;
   * kept on the props so that wiring is available again without a redesign if the list
   * ever goes back inside something.
   */
  onChanged?: (favorites: FavPhoto[]) => void;
}) {
  const [favorites, setFavorites] = useState(initialFavorites);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  // An out-of-range index renders nothing, so one number means "closed" — the contract
  // PhotoLightbox documents.
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  // Whether the lightbox is advancing on its own. Lives here rather than inside the
  // overlay because the Slideshow button below opens it already playing.
  const [isPlaying, setIsPlaying] = useState(false);

  // Re-reads after every write, rather than patching the row locally. The list is
  // small and this is one round trip on an action the reader just took, which buys
  // correctness when the same person has the app open on their phone as well.
  const refresh = useCallback(async () => {
    const fresh = await listFavPhotosAction();
    setFavorites(fresh);
    onChanged?.(fresh);
    return fresh;
  }, [onChanged]);

  const handleSaveNote = useCallback(
    async (relativePath: string, note: string) => {
      setError(undefined);
      try {
        const written = await setFavPhotoNoteAction(relativePath, note);
        if (!written) {
          // The row went away between opening the screen and this blur.
          setError("That photo is no longer a favourite, so the note wasn't saved.");
        }
        await refresh();
      } catch {
        setError("Couldn't save the note.");
      }
    },
    [refresh],
  );

  /**
   * Un-stars one or several favourites.
   *
   * One path for both the row's trash button and the bulk action, because they are the
   * same operation at different sizes — and the server call takes a list either way.
   * Only the bulk case confirms: a single row's button is one undo-able mistake, while
   * "remove 40 photos" is not something to do on a mis-tap.
   */
  const handleRemove = useCallback(
    async (relativePaths: string[], onDone?: () => void) => {
      if (relativePaths.length === 0) return;
      setError(undefined);
      setNotice(undefined);

      if (
        relativePaths.length > 1 &&
        !window.confirm(
          `Remove ${relativePaths.length} photos from your favorites? The pictures themselves are not deleted.`,
        )
      ) {
        return;
      }

      setIsBulkBusy(true);
      try {
        const result = await removeFavPhotosAction(relativePaths);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // The two numbers only differ when the list on screen was stale — a row removed
        // on another device in the meantime. Worth saying, but not worth a sentence when
        // everything went as asked.
        setNotice(
          result.missing > 0
            ? `Removed ${result.removed} of ${relativePaths.length} — the rest were already gone.`
            : `Removed ${result.removed} from favorites.`,
        );
        onDone?.();
        await refresh();
      } catch {
        setError("Couldn't remove those favourites.");
      } finally {
        setIsBulkBusy(false);
      }
    },
    [refresh],
  );

  /**
   * Downloads the selected photographs as one zip.
   *
   * A `fetch` and a blob rather than pointing an `<a download>` at the route, because
   * the route is a POST — see the route's own comment for why the selection travels in
   * a body instead of a query string. The cost is this function: the response has to be
   * read, turned into a blob and saved by hand, and errors arrive as JSON rather than
   * as a browser download failure. Worth it to keep 200 long paths out of a URL.
   *
   * The selection is deliberately KEPT afterwards. Downloading a set and then removing
   * it is the obvious next move, and clearing the ticks would make the reader select
   * all of it again.
   */
  const handleDownload = useCallback(async (rows: FavPhoto[]) => {
    if (rows.length === 0) return;
    setError(undefined);
    setNotice(undefined);
    setIsBulkBusy(true);

    try {
      const response = await fetch("/api/journal/photos/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: rows.map((row) => row.relativePath) }),
      });

      if (!response.ok) {
        // The route reports the actionable cases (too many, too large, none readable)
        // as JSON with a message meant to be shown.
        const body = await response.json().catch(() => undefined);
        setError(body?.error ?? "Couldn't build that download.");
        return;
      }

      // The name the route chose, so the date in it comes from one place. Falls back
      // only if the header is somehow absent.
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "favorite-photos.zip";
      const missing = Number(response.headers.get("X-Missing-Photos") ?? "0");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      // A favourite whose file has gone is skipped by the route rather than failing the
      // whole download, so the count is reported here instead of silently differing
      // from what was selected.
      setNotice(
        missing > 0
          ? `Downloaded ${rows.length - missing} of ${rows.length} — ${missing} could not be found in the archive.`
          : `Downloaded ${rows.length} photo${rows.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setError("Couldn't download those photos.");
    } finally {
      setIsBulkBusy(false);
    }
  }, []);

  // A removal can leave the lightbox pointing past the end of a now-shorter list.
  // Clamped during render rather than corrected in an effect: an effect would paint one
  // frame of the wrong photo first, and `PhotoLightbox` already treats an out-of-range
  // index as "show nothing", so closing it is a matter of not rendering it.
  const openIndex = lightboxIndex < favorites.length ? lightboxIndex : -1;

  /** Opens the lightbox on the first photo, already running. */
  function startSlideshow() {
    if (favorites.length === 0) return;
    setLightboxIndex(0);
    setIsPlaying(true);
  }

  /** Closing stops the timer too, so re-opening a photo by hand is not a slideshow. */
  function closeLightbox() {
    setLightboxIndex(-1);
    setIsPlaying(false);
  }

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
            disabled={isBulkBusy}
            onClick={() => void handleRemove([row.relativePath])}
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
    <div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-3 text-sm text-muted">{notice}</p>}

      {/* Above the grid, not in the selection bar: it plays the whole list, so it is
          not an action on the ticked rows. `flex-wrap` so it sits on its own line on a
          phone rather than squeezing anything. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={favorites.length === 0}
          onClick={startSlideshow}
          title="Show every favourite, five seconds each"
        >
          {/* Text plus a character, matching the neighbouring "Download N" — there is
              no play glyph in the icon set. */}
          ▶ Slideshow
        </Button>
        {favorites.length > 0 && (
          <span className="text-xs text-muted">
            {favorites.length} photo{favorites.length === 1 ? "" : "s"}, 5 seconds each
          </span>
        )}
      </div>

      <DataGrid
        columns={columns}
        rows={favorites}
        getRowKey={(row) => row.relativePath}
        emptyMessage="No favourite photos yet — press the heart on the random photo card to keep one."
        exportFileName="favorite-photos"
        storageKey="home:fav-photos"
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBulkBusy}
              onClick={() => void handleDownload(selectedRows)}
            >
              {/* Text, not a glyph: there is no `download` icon in the set, and
                  inventing one for a bulk action would be the wrong place to start. */}
              {isBulkBusy ? "Working…" : `Download ${selectedRows.length}`}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isBulkBusy}
              onClick={() =>
                void handleRemove(
                  selectedRows.map((row) => row.relativePath),
                  clearSelection,
                )
              }
            >
              Remove from favorites
            </Button>
          </>
        )}
        // Clicking a row opens the photo. The note field, the checkbox and the remove
        // button stop their own clicks from reaching it, so each control does one thing.
        // Clearing `isPlaying` matters as well as setting the index: a removal can
        // close the overlay by shortening the list (see the clamp above), which leaves
        // the play flag set with nothing rendered to consume it — and the next click on
        // a row would then open straight into a running slideshow nobody asked for.
        onRowClick={(row) => {
          setIsPlaying(false);
          setLightboxIndex(favorites.findIndex((one) => one.relativePath === row.relativePath));
        }}
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
          onClose={closeLightbox}
          isPlaying={isPlaying}
          onPlayingChange={setIsPlaying}
        />
      )}
    </div>
  );
}
