"use client";

// The four props `PhotoViewer` needs to offer its "add to album" (+) menu, in one
// place.
//
// A hook rather than a component, and it lives here rather than in `src/components/`,
// because it is the WIRING between the viewer and this module's server actions —
// `src/components/` may not import from `src/app/`, so a shared component could never
// hold this. Every screen that shows a photograph wants the same behaviour, and three
// copies of the load-then-file-then-re-read dance is three chances to get the viewer's
// resolve contract wrong.
//
// Spread straight onto the viewer: `<PhotoViewer {...useAlbumFiling()} … />`.

import { useCallback, useEffect, useState } from "react";
import type { ViewerAlbum } from "@/components/photo-viewer";
import {
  addPhotosToAlbumAction,
  albumIdsContainingAction,
  createAlbumAction,
  listAlbumsAction,
} from "./gallery-album-actions";

/** Exactly the shape `PhotoViewer`'s album props expect. */
export interface AlbumFilingProps {
  albums: ViewerAlbum[];
  albumIdsFor: (relativePath: string) => number[] | undefined;
  onAddToAlbum: (albumId: number, relativePath: string) => Promise<void>;
  onCreateAlbum: (
    name: string,
    relativePath: string,
  ) => Promise<{ ok: true; album: ViewerAlbum } | { ok: false; error: string }>;
}

export function useAlbumFiling(): AlbumFilingProps {
  const [albums, setAlbums] = useState<ViewerAlbum[]>([]);
  // Which albums hold a given path. Keyed by path; a MISSING key means "not looked up
  // yet", which the viewer renders as an un-ticked row rather than as a claim that the
  // photo is in no album. An empty array means "looked, and it is in none".
  const [idsByPath, setIdsByPath] = useState<Record<string, number[]>>({});

  // The album list is read once on mount rather than per photo: it changes only when
  // somebody makes or deletes an album, which is rare, and re-reading it on every arrow
  // key would be a round trip per picture for a list that almost never differs.
  useEffect(() => {
    let isCurrent = true;
    listAlbumsAction()
      .then((fresh) => {
        if (isCurrent) setAlbums(fresh.map(({ id, name }) => ({ id, name })));
      })
      // Swallowed: a viewer that cannot reach the album list should still show the
      // photograph. The menu renders "no albums yet", which is wrong but harmless, and
      // any actual filing attempt reports its own failure.
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, []);

  /**
   * Which albums hold this photo — and, on a miss, starts the lookup.
   *
   * The fetch is kicked off from inside a render-phase read, which needs care: the
   * `setIdsByPath` below only ever runs from the promise callback (never synchronously
   * during render), and the `in` check makes a second call for the same path a no-op,
   * so this cannot loop. It is written this way because the viewer asks per photo and
   * has no lifecycle hook to tell us which photo it moved to.
   */
  const albumIdsFor = useCallback(
    (relativePath: string): number[] | undefined => {
      if (relativePath in idsByPath) return idsByPath[relativePath];

      void albumIdsContainingAction(relativePath)
        .then((ids) => setIdsByPath((current) => ({ ...current, [relativePath]: ids })))
        .catch(() =>
          // Recorded as "in no album" rather than left absent, so a failed lookup is
          // not retried on every render of the same photo.
          setIdsByPath((current) => ({ ...current, [relativePath]: [] })),
        );

      return undefined;
    },
    [idsByPath],
  );

  /**
   * Files a photo into an album.
   *
   * DOES NOT RESOLVE UNTIL `albumIdsFor` WOULD RETURN THE NEW ANSWER — the viewer's
   * documented contract. It drops its optimistic tick on resolve, so returning before
   * the state below has landed would make the tick flick off for a render.
   *
   * Throws on a refusal so the viewer restores its tick and shows its own message; the
   * `{ ok: false }` cases here (album deleted, album full) are all states where the
   * add genuinely did not happen.
   */
  const onAddToAlbum = useCallback(async (albumId: number, relativePath: string) => {
    const result = await addPhotosToAlbumAction(albumId, [relativePath]);
    if (!result.ok) throw new Error(result.error);

    // Patched locally rather than re-read: we know exactly which album gained which
    // path, and a round trip here would be a second wait the reader can feel on every
    // click. The list is re-read only when its membership could have changed elsewhere.
    setIdsByPath((current) => {
      const existing = current[relativePath] ?? [];
      if (existing.includes(albumId)) return current;
      return { ...current, [relativePath]: [...existing, albumId] };
    });
  }, []);

  /** Makes an album and files the photo into it, in one gesture from the menu. */
  const onCreateAlbum = useCallback(
    async (
      name: string,
      relativePath: string,
    ): Promise<{ ok: true; album: ViewerAlbum } | { ok: false; error: string }> => {
      const created = await createAlbumAction(name, "");
      // A duplicate name. Reported rather than thrown: it is a message about the text
      // the reader just typed, and the menu keeps the field so they can edit it.
      if (!created.ok) return { ok: false, error: created.error };

      const album = { id: created.value.id, name: created.value.name };

      const added = await addPhotosToAlbumAction(album.id, [relativePath]);
      if (!added.ok) {
        // The album exists but the photo did not go in. Say exactly that — the album
        // is deliberately NOT rolled back, because the reader asked for it and
        // deleting it silently would be a surprise.
        setAlbums((current) => [album, ...current]);
        return {
          ok: false,
          error: `Made “${album.name}”, but couldn't add the photo to it.`,
        };
      }

      // Prepended, matching the album list's own newest-first order.
      setAlbums((current) => [album, ...current]);
      setIdsByPath((current) => ({
        ...current,
        [relativePath]: [...(current[relativePath] ?? []), album.id],
      }));

      return { ok: true, album };
    },
    [],
  );

  return { albums, albumIdsFor, onAddToAlbum, onCreateAlbum };
}
