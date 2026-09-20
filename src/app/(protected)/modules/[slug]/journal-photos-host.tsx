// The one place that wires the journal's photo server actions to the reusable
// `PhotoOfTheDay` dialog.
//
// It exists because `src/components/` may not import a server action (ARCHITECTURE.md
// → the component is pure presentation, props in and events out). Rather than have the
// calendar and the entry viewer each repeat the same bindings, both call this.
//
// It binds two groups: the folder/photo lookups the dialog needs to find pictures, and
// the favourite + album plumbing the VIEWER inside it needs to offer the heart and the
// `+` menu. The second group is why a photograph opened from a journal entry can be
// kept or filed at all — `PhotoViewer` renders those controls only when their callbacks
// are supplied, so before this they were absent on every journal path.
//
// No logic of its own beyond dispatching one query shape to one of two action pairs,
// and holding the kept-paths set the heart reads.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PhotoOfTheDay,
  type PhotoDateRange,
  type PhotoQuery,
} from "@/components/photo-of-the-day";
import {
  findPhotoFoldersAction,
  findPhotoFoldersInRangeAction,
  listPhotosInFolderAction,
  listPhotosInFolderForRangeAction,
} from "./entries/[id]/journal-photos-actions";
import { listFavPhotosAction, toggleFavPhotoAction } from "./gallery-photo-actions";
import { useAlbumFiling } from "./use-album-filing";

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

export interface JournalPhotosHostProps {
  /** A single day, `YYYY-MM-DD`. Pass this or `range`, not both. */
  date?: string;
  /** A span of days. Pass this or `date`, not both. */
  range?: PhotoDateRange;
  /** Returns the reader to the screen that opened the dialog. */
  onClose: () => void;
  /** Start looking on mount. True for the calendar's buttons — see the dialog's prop. */
  autoLookup?: boolean;
}

/**
 * The favourite half of the viewer's controls: a kept-paths set, and the toggle.
 *
 * Inline here rather than a shared hook because it is nine lines over one action pair,
 * and the gallery's own screens already hold a favourites list for their own rendering
 * — they have nothing to reuse from this.
 *
 * The set is read once on mount. The archive has far more photographs than anyone
 * stars, so holding every kept path is cheaper than asking per picture as the reader
 * arrows through a folder.
 */
function useFavoritePhotos() {
  const [favoritePaths, setFavoritePaths] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let isCurrent = true;
    listFavPhotosAction()
      .then((favorites) => {
        if (isCurrent) setFavoritePaths(new Set(favorites.map((f) => f.relativePath)));
      })
      // Swallowed for the reason `useAlbumFiling` swallows its own load: a viewer that
      // cannot reach the list should still show the photograph. The heart then reads
      // "not kept", and a toggle reports its own failure.
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, []);

  const isFavorite = useCallback(
    (relativePath: string) => favoritePaths.has(relativePath),
    [favoritePaths],
  );

  /**
   * Flips the heart.
   *
   * DOES NOT RESOLVE UNTIL `isFavorite` WOULD RETURN THE NEW ANSWER — the viewer's
   * documented contract. It drops its optimistic glyph on resolve, so resolving before
   * the set below has landed would make the heart flick back for one render. The action
   * returns the state it landed in, so this needs no re-read of the whole list.
   */
  const onToggleFavorite = useCallback(async (relativePath: string) => {
    const isNowFavorite = await toggleFavPhotoAction(relativePath);
    setFavoritePaths((current) => {
      const next = new Set(current);
      if (isNowFavorite) next.add(relativePath);
      else next.delete(relativePath);
      return next;
    });
    return isNowFavorite;
  }, []);

  return { isFavorite, onToggleFavorite };
}

export function JournalPhotosHost({ date, range, onClose, autoLookup }: JournalPhotosHostProps) {
  // The same two bundles the gallery's screens pass, so a photograph opened from a
  // journal entry offers the heart and the `+` menu it offers anywhere else. Both are
  // spread unconditionally: the favourite and album writes authorise on a session
  // rather than on the Picture Gallery grant, because any signed-in reader can already
  // fetch these bytes from `/api/journal/photos`.
  const albumFiling = useAlbumFiling();
  const { isFavorite, onToggleFavorite } = useFavoritePhotos();

  return (
    <PhotoOfTheDay
      date={date}
      range={range}
      onClose={onClose}
      autoLookup={autoLookup}
      photoUrl={photoUrl}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      {...albumFiling}
      onFindFolders={(query) =>
        // A single date and a range are two different actions rather than one taking
        // `from === to`, so each boundary validates the question it was actually asked.
        "date" in query
          ? findPhotoFoldersAction(query.date)
          : findPhotoFoldersInRangeAction(query.from, query.to)
      }
      onListPhotos={(query: PhotoQuery, relativePath, includeAll) =>
        "date" in query
          ? listPhotosInFolderAction(query.date, relativePath, includeAll)
          : listPhotosInFolderForRangeAction(query.from, query.to, relativePath, includeAll)
      }
    />
  );
}
