"use client";

// The Albums section: the grid of albums, and the one album a reader has opened.
//
// ONE component for both, not two screens, because opening an album is a change of
// depth rather than of place — the section panel still says "Albums", and Back should
// return to the grid rather than to whatever preceded the section. The open album is
// therefore local state, not a route.
//
// A one-off island like `gallery-fav-photos-list.tsx` next door, and for the same
// reason: nothing else in the app shows a list of photo albums. If a second caller
// ever appears, that is the moment to promote pieces of this to `src/components/` —
// not before.
//
// Narrow behaviour: the album grid is `.card-grid`, so the column count follows the
// space rather than a breakpoint (design.md, "Collections size themselves"). The open
// album's photo grid is `.tile-grid` for the same reason. Everything else is restyled
// with `max-lg:` variants, so the desktop classes provably cannot regress.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { PhotoViewer } from "@/components/photo-viewer";
import { TreeIcon } from "@/components/tree-icons";
import type { AlbumSummary, AlbumWithPhotos } from "@/lib/albums";
import { readPhotoDetailsAction } from "../../photos-viewer-actions";
import {
  createAlbumAction,
  deleteAlbumAction,
  getAlbumAction,
  listAlbumsAction,
  removePhotosFromAlbumAction,
  updateAlbumAction,
} from "./gallery-album-actions";
import { useAlbumFiling } from "./use-album-filing";

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

/** The file name, for a caption. */
function fileNameOf(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

/** The folder it came from, for the dimmer second line. */
function folderOf(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments.slice(0, -1).join(" / ");
}

/** `3 photos`, or `1 photo`. */
function photoCountLabel(count: number): string {
  return `${count} photo${count === 1 ? "" : "s"}`;
}

/** The form shared by "New album" and "Rename" — the two write the same two fields. */
function AlbumForm({
  initialName,
  initialDescription,
  submitLabel,
  isBusy,
  error,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialDescription: string;
  submitLabel: string;
  isBusy: boolean;
  error?: string;
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name, description);
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="album-name" className="mb-1 block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="album-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
          // Autofocused because this dialog exists to receive one short answer.
          autoFocus
          placeholder="Croatia 2019"
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </div>

      <div>
        <label
          htmlFor="album-description"
          className="mb-1 block text-sm font-medium text-ink"
        >
          Description <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="album-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Two weeks along the Dalmatian coast."
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </div>

      {error !== undefined && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button type="submit" disabled={isBusy || name.trim() === ""}>
          {isBusy ? "Working…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function AlbumsView({ initialAlbums }: { initialAlbums: AlbumSummary[] }) {
  const [albums, setAlbums] = useState(initialAlbums);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  // Which album is open, and its photos. `undefined` means the grid is showing.
  const [openAlbum, setOpenAlbum] = useState<AlbumWithPhotos | undefined>(undefined);

  // The dialogs. `creating` is a flag; `editing` carries the album being renamed.
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<AlbumSummary | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  // Selection within an open album, by path. A Set because the only questions asked of
  // it are "is this ticked" and "how many".
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Which photo the viewer OPENS on; -1 means closed, and `playing` opens it running.
  const [openAtIndex, setOpenAtIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  // The viewer's "add to album" plumbing, so a picture opened from inside one album can
  // be filed into another without leaving the stage.
  const albumFiling = useAlbumFiling();

  /** Re-reads the album list after a write. */
  const refreshAlbums = useCallback(async () => {
    const fresh = await listAlbumsAction();
    setAlbums(fresh);
    return fresh;
  }, []);

  /** Re-reads the open album, so its photo grid reflects what is stored. */
  const refreshOpenAlbum = useCallback(async (albumId: number) => {
    const fresh = await getAlbumAction(albumId);
    // `undefined` means it was deleted in another tab — fall back to the grid rather
    // than leaving a detail screen for something that no longer exists.
    setOpenAlbum(fresh);
    if (fresh === undefined) setSelected(new Set());
    return fresh;
  }, []);

  const handleCreate = useCallback(
    async (name: string, description: string) => {
      setFormError(undefined);
      setIsBusy(true);
      try {
        const result = await createAlbumAction(name, description);
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        setIsCreating(false);
        setNotice(`Created “${result.value.name}”.`);
        await refreshAlbums();
      } catch {
        setFormError("Couldn't create that album.");
      } finally {
        setIsBusy(false);
      }
    },
    [refreshAlbums],
  );

  const handleRename = useCallback(
    async (name: string, description: string) => {
      if (editing === undefined) return;
      setFormError(undefined);
      setIsBusy(true);
      try {
        const result = await updateAlbumAction(editing.id, name, description);
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        setEditing(undefined);
        await refreshAlbums();
        // Keep the open album's header in step when it is the one being renamed.
        if (openAlbum?.id === editing.id) await refreshOpenAlbum(editing.id);
      } catch {
        setFormError("Couldn't save that album.");
      } finally {
        setIsBusy(false);
      }
    },
    [editing, openAlbum, refreshAlbums, refreshOpenAlbum],
  );

  /**
   * Deletes an album after confirming.
   *
   * The confirm text says the photographs survive, because "delete album" is a
   * sentence a reader can reasonably read the other way — and the answer matters
   * enough that it should not depend on having read a doc.
   */
  const handleDelete = useCallback(
    async (album: AlbumSummary) => {
      if (
        !window.confirm(
          `Delete the album “${album.name}”?\n\nThe ${photoCountLabel(album.photoCount)} in it stay in your photo archive — only the album is removed.`,
        )
      ) {
        return;
      }

      setError(undefined);
      setNotice(undefined);
      setIsBusy(true);
      try {
        const result = await deleteAlbumAction(album.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(`Deleted “${album.name}”.`);
        if (openAlbum?.id === album.id) {
          setOpenAlbum(undefined);
          setSelected(new Set());
        }
        await refreshAlbums();
      } catch {
        setError("Couldn't delete that album.");
      } finally {
        setIsBusy(false);
      }
    },
    [openAlbum, refreshAlbums],
  );

  /** Opens an album, reading its photos. */
  const handleOpen = useCallback(async (albumId: number) => {
    setError(undefined);
    setNotice(undefined);
    setSelected(new Set());
    setIsBusy(true);
    try {
      const album = await getAlbumAction(albumId);
      if (album === undefined) {
        setError("That album no longer exists.");
        await listAlbumsAction().then(setAlbums);
        return;
      }
      setOpenAlbum(album);
    } catch {
      setError("Couldn't open that album.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  /** Unfiles the ticked photographs from the open album. */
  const handleRemovePhotos = useCallback(async () => {
    if (openAlbum === undefined || selected.size === 0) return;

    if (
      !window.confirm(
        `Remove ${photoCountLabel(selected.size)} from “${openAlbum.name}”?\n\nThe pictures themselves are not deleted.`,
      )
    ) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setIsBusy(true);
    try {
      const result = await removePhotosFromAlbumAction(openAlbum.id, [...selected]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(`Removed ${photoCountLabel(result.value.removed)} from the album.`);
      setSelected(new Set());
      await refreshOpenAlbum(openAlbum.id);
      await refreshAlbums();
    } catch {
      setError("Couldn't remove those photos.");
    } finally {
      setIsBusy(false);
    }
  }, [openAlbum, selected, refreshAlbums, refreshOpenAlbum]);

  /**
   * Exports an album, or the ticked photographs within it, as one zip.
   *
   * A `fetch` and a blob rather than an `<a download>`, because the route is a POST —
   * see the route's comment for why. Passing `{ albumId }` rather than the paths for a
   * whole-album export means the server exports the album AS STORED, in its own order,
   * rather than whatever this tab last rendered.
   */
  const handleExport = useCallback(
    async (album: AlbumWithPhotos, onlySelected: boolean) => {
      const paths = onlySelected ? [...selected] : undefined;
      if (onlySelected && (paths === undefined || paths.length === 0)) return;

      setError(undefined);
      setNotice(undefined);
      setIsBusy(true);
      try {
        const response = await fetch("/api/journal/photos/zip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paths === undefined ? { albumId: album.id } : { paths }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          setError(body?.error ?? "Couldn't build that download.");
          return;
        }

        // The name the route chose, so the date in it comes from one place.
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "album.zip";
        const missing = Number(response.headers.get("X-Missing-Photos") ?? "0");
        const asked = paths?.length ?? album.photos.length;

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);

        // A photo whose file has gone is skipped by the route rather than failing the
        // whole export, so the count is reported rather than silently differing.
        setNotice(
          missing > 0
            ? `Exported ${asked - missing} of ${asked} — ${missing} could not be found in the archive.`
            : `Exported ${photoCountLabel(asked)}.`,
        );
      } catch {
        setError("Couldn't export those photos.");
      } finally {
        setIsBusy(false);
      }
    },
    [selected],
  );

  /** The viewer's photo set for the open album, in the album's own order. */
  const viewerPhotos = useMemo(
    () =>
      (openAlbum?.photos ?? []).map((photo) => ({
        name: fileNameOf(photo.relativePath),
        relativePath: photo.relativePath,
        subcaption: folderOf(photo.relativePath),
      })),
    [openAlbum],
  );

  // An unfiling can leave the opening index past the end of a now-shorter album.
  // Clamped during render rather than corrected in an effect, which would paint one
  // frame of the wrong photo first.
  const openIndex = openAtIndex < viewerPhotos.length ? openAtIndex : -1;

  // Escape closes the open album, matching what it does in every dialog in the app.
  // Skipped while the viewer is up — that owns Escape for itself, and closing both at
  // once would take the reader two levels back on one press.
  useEffect(() => {
    if (openAlbum === undefined || openIndex >= 0) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenAlbum(undefined);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openAlbum, openIndex]);

  function toggleSelected(relativePath: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }

  return (
    <div>
      {/* Messages sit above everything, so a result is in the same place whichever
          depth raised it. */}
      {error !== undefined && (
        <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {notice !== undefined && (
        <p className="mb-3 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-muted">
          {notice}
        </p>
      )}

      {openAlbum === undefined ? (
        <AlbumGrid
          albums={albums}
          isBusy={isBusy}
          onCreate={() => {
            setFormError(undefined);
            setIsCreating(true);
          }}
          onOpen={(albumId) => void handleOpen(albumId)}
          onRename={(album) => {
            setFormError(undefined);
            setEditing(album);
          }}
          onDelete={(album) => void handleDelete(album)}
        />
      ) : (
        <OpenAlbum
          album={openAlbum}
          selected={selected}
          isBusy={isBusy}
          onBack={() => {
            setOpenAlbum(undefined);
            setSelected(new Set());
          }}
          onToggleSelected={toggleSelected}
          onSelectAll={() =>
            setSelected(new Set(openAlbum.photos.map((photo) => photo.relativePath)))
          }
          onClearSelection={() => setSelected(new Set())}
          onOpenPhoto={(index) => {
            setIsPlaying(false);
            setOpenAtIndex(index);
          }}
          onSlideshow={() => {
            if (openAlbum.photos.length === 0) return;
            setOpenAtIndex(0);
            setIsPlaying(true);
          }}
          onExport={(onlySelected) => void handleExport(openAlbum, onlySelected)}
          onRemovePhotos={() => void handleRemovePhotos()}
          onRename={() => {
            setFormError(undefined);
            const summary = albums.find((one) => one.id === openAlbum.id);
            if (summary !== undefined) setEditing(summary);
          }}
        />
      )}

      {isCreating && (
        <Modal
          title="New album"
          description="Give it a name now; add photographs to it from any picture in the archive."
          onClose={() => setIsCreating(false)}
          isBusy={isBusy}
        >
          <AlbumForm
            initialName=""
            initialDescription=""
            submitLabel="Create album"
            isBusy={isBusy}
            error={formError}
            onSubmit={(name, description) => void handleCreate(name, description)}
            onCancel={() => setIsCreating(false)}
          />
        </Modal>
      )}

      {editing !== undefined && (
        <Modal
          title={`Rename “${editing.name}”`}
          onClose={() => setEditing(undefined)}
          isBusy={isBusy}
        >
          <AlbumForm
            initialName={editing.name}
            initialDescription={editing.description}
            submitLabel="Save"
            isBusy={isBusy}
            error={formError}
            onSubmit={(name, description) => void handleRename(name, description)}
            onCancel={() => setEditing(undefined)}
          />
        </Modal>
      )}

      {/* The viewer walks the whole album, in the album's order, so prev/next browses
          the collection as it was arranged.

          The SET form: an album is paths gathered from all over the archive, which no
          single folder listing could produce. `key` on the opening index remounts it
          when a different tile is clicked, which is what makes `initialIndex` — read
          once at mount — land on the right photo every time.

          No favourite props here: filing and starring are different acts, and a heart
          on this stage would invite the reader to think one implies the other. The
          favourites screen is where the heart belongs. */}
      {openIndex >= 0 && (
        <PhotoViewer
          key={openIndex}
          photos={viewerPhotos}
          initialIndex={openIndex}
          autoPlay={isPlaying}
          photoUrl={photoUrl}
          onPhotoDetails={readPhotoDetailsAction}
          {...albumFiling}
          onClose={() => {
            setOpenAtIndex(-1);
            setIsPlaying(false);
          }}
        />
      )}
    </div>
  );
}

/** The grid of albums, and the button that makes another. */
function AlbumGrid({
  albums,
  isBusy,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: {
  albums: AlbumSummary[];
  isBusy: boolean;
  onCreate: () => void;
  onOpen: (albumId: number) => void;
  onRename: (album: AlbumSummary) => void;
  onDelete: (album: AlbumSummary) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {albums.length === 0
            ? "No albums yet."
            : `${albums.length} album${albums.length === 1 ? "" : "s"}.`}
        </p>
        <Button onClick={onCreate} disabled={isBusy}>
          New album
        </Button>
      </div>

      {albums.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-muted">
            An album is a set of pictures you choose — from any folder, in any order.
            Make one here, then add photographs to it with the{" "}
            <span className="font-medium text-ink">+</span> button on any picture.
          </p>
        </div>
      ) : (
        /* `.card-grid`, not `grid-cols-N max-lg:grid-cols-1`: the column count follows
           the space available, so a 402px phone and an 810px tablet get different
           counts rather than the same one. See design.md. */
        <div className="card-grid gap-4">
          {albums.map((album) => (
            <div
              key={album.id}
              className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper-raised"
            >
              {/* The cover is a button, so the whole picture is the way in. */}
              <button
                type="button"
                onClick={() => onOpen(album.id)}
                className="group relative block aspect-[4/3] w-full overflow-hidden bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                aria-label={`Open ${album.name}`}
              >
                {album.coverPath === undefined ? (
                  <span className="flex h-full items-center justify-center text-muted">
                    <TreeIcon name="album" className="h-10 w-10" />
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- the bytes
                     come from our own session-gated route over a NAS share, not a
                     static asset next/image can optimize. */
                  <img
                    src={photoUrl(album.coverPath)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                )}
              </button>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <button
                  type="button"
                  onClick={() => onOpen(album.id)}
                  className="text-left font-display text-base text-ink hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  {album.name}
                </button>
                <p className="text-xs text-muted">{photoCountLabel(album.photoCount)}</p>
                {album.description !== "" && (
                  <p className="line-clamp-2 text-xs text-muted">{album.description}</p>
                )}

                {/* Row actions stay hand-drawn glyphs — see ALWAYS_CLASSIC. */}
                <div className="mt-2 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => onRename(album)}
                    disabled={isBusy}
                    aria-label={`Rename ${album.name}`}
                    title="Rename"
                    className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-50"
                  >
                    <TreeIcon name="pencil" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(album)}
                    disabled={isBusy}
                    aria-label={`Delete ${album.name}`}
                    title="Delete"
                    className="rounded p-1.5 text-muted hover:bg-paper hover:text-red-500 disabled:opacity-50"
                  >
                    <TreeIcon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One opened album: its header, its actions, and its photographs. */
function OpenAlbum({
  album,
  selected,
  isBusy,
  onBack,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onOpenPhoto,
  onSlideshow,
  onExport,
  onRemovePhotos,
  onRename,
}: {
  album: AlbumWithPhotos;
  selected: Set<string>;
  isBusy: boolean;
  onBack: () => void;
  onToggleSelected: (relativePath: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenPhoto: (index: number) => void;
  onSlideshow: () => void;
  onExport: (onlySelected: boolean) => void;
  onRemovePhotos: () => void;
  onRename: () => void;
}) {
  const hasSelection = selected.size > 0;
  const isEmpty = album.photos.length === 0;

  return (
    <div>
      {/* The header wraps rather than scrolls on a phone: five controls at 390px do not
          fit on one line, and a horizontally scrolling action bar hides the action a
          reader came for. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 flex items-center gap-1 text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span aria-hidden="true">&larr;</span> All albums
          </button>
          <h2 className="truncate font-display text-xl text-ink">{album.name}</h2>
          <p className="text-sm text-muted">
            {photoCountLabel(album.photos.length)}
            {hasSelection ? ` · ${selected.size} selected` : ""}
          </p>
          {album.description !== "" && (
            <p className="mt-1 max-w-prose text-sm text-muted">{album.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onRename} disabled={isBusy}>
            Rename
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onSlideshow}
            disabled={isBusy || isEmpty}
          >
            Slideshow
          </Button>
          <Button
            size="sm"
            onClick={() => onExport(hasSelection)}
            disabled={isBusy || isEmpty}
          >
            {/* The label says what will actually happen, because the same button does
                both jobs depending on whether anything is ticked. */}
            {isBusy
              ? "Working…"
              : hasSelection
                ? `Export ${selected.size}`
                : "Export album"}
          </Button>
        </div>
      </div>

      {hasSelection && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper-raised px-3 py-2">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onClearSelection}>
              Clear
            </Button>
            <Button size="sm" variant="danger" onClick={onRemovePhotos} disabled={isBusy}>
              Remove from album
            </Button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-muted">
            This album is empty. Open any picture and use the{" "}
            <span className="font-medium text-ink">+</span> button to add it here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={selected.size === album.photos.length ? onClearSelection : onSelectAll}
              className="text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {selected.size === album.photos.length ? "Select none" : "Select all"}
            </button>
          </div>

          {/* `.tile-grid`, so the thumbnails reflow continuously rather than snapping
              between two column counts at 1024px. */}
          <div className="tile-grid gap-2">
            {album.photos.map((photo, index) => {
              const isSelected = selected.has(photo.relativePath);
              return (
                <div key={photo.relativePath} className="relative">
                  <button
                    type="button"
                    onClick={() => onOpenPhoto(index)}
                    className={`block aspect-square w-full overflow-hidden rounded-md border bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                      isSelected ? "border-brass ring-2 ring-brass" : "border-line"
                    }`}
                    aria-label={`Open ${fileNameOf(photo.relativePath)}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own
                        session-gated route over a NAS share. */}
                    <img
                      src={photoUrl(photo.relativePath)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>

                  {/* The tick sits over the picture rather than beside it: a checkbox
                      column would halve the thumbnail on a phone. `h-6 w-6` is a real
                      tap target at the size these tiles render. */}
                  <label
                    className="absolute left-1 top-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-black/50"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelected(photo.relativePath)}
                      aria-label={`Select ${fileNameOf(photo.relativePath)}`}
                      className="h-4 w-4 accent-[var(--brass)]"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
