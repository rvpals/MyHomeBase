"use client";

// Wires the shared SelectionBar to the Music Library's playlists.
//
// The split matters: `SelectionBar` in src/components/ is pure presentation and knows
// nothing about playlists, so it stays reusable (ARCHITECTURE.md forbids data fetching in
// a reusable component). Everything module-specific — which server actions to call, what a
// "target" is, what the feedback says — lives here.

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  SelectionBar,
  useSelection,
  type SelectionState,
} from "@/components/selection-bar";
import type { Playlist } from "@/lib/music";
import { addToPlaylistAction, createPlaylistAction, listPlaylistsAction } from "./music-actions";

/** Re-exported so the views import their selection state from one place. */
export { useSelection as useTrackSelection };
export type { SelectionState as TrackSelection };

export function PlaylistSelectionBar({
  selection,
  pageTrackIds,
}: {
  selection: SelectionState;
  pageTrackIds: readonly number[];
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [isBusy, startBusy] = useTransition();

  const refresh = useCallback(async () => {
    setPlaylists(await listPlaylistsAction());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listPlaylistsAction().then((rows) => {
      if (!cancelled) setPlaylists(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = (playlistId: number) =>
    startBusy(async () => {
      const trackIds = [...selection.selected];
      const result = await addToPlaylistAction({ playlistId, trackIds });
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      const name = playlists.find((entry) => entry.id === playlistId)?.name ?? "the playlist";
      setMessage(`Added ${result.added} to ${name}.`);
      selection.clear();
      await refresh();
    });

  const createAndSend = (name: string) =>
    startBusy(async () => {
      const trackIds = [...selection.selected];
      const created = await createPlaylistAction({ name });
      if ("error" in created) {
        setMessage(created.error);
        return;
      }
      const result = await addToPlaylistAction({ playlistId: created.id, trackIds });
      setMessage(
        "error" in result ? result.error : `Created "${name.trim()}" with ${result.added}.`,
      );
      selection.clear();
      await refresh();
    });

  return (
    <SelectionBar
      selection={selection}
      pageIds={pageTrackIds}
      targets={playlists.map((playlist) => ({
        id: playlist.id,
        label: playlist.name,
        detail: String(playlist.trackCount),
      }))}
      onSend={send}
      onCreateAndSend={createAndSend}
      isBusy={isBusy}
      message={message}
      itemNoun="track"
      targetNoun="playlist"
    />
  );
}
