"use client";

// The Queue screen: what is lined up, and the controls for changing it.
//
// The queue was invisible before this screen existed -- it was set by clicking a track in
// a list and could only be observed by pressing Next and seeing what happened. Everything
// here reads from the player provider, which holds the persisted queue (migrations/0059);
// no fetching happens in this file.
//
// Narrow screens restyle with `max-lg:` rather than switching component: it is the same
// ordered list either way, with the toolbar wrapping and the format column dropping out.
// Same call `music-track-list.tsx` made, for the same reason.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  formatPlayerTime,
  useMusicPlayer,
  type QueueRow,
  type RepeatMode,
} from "@/components/music-player-provider";
import type { Playlist } from "@/lib/music";
import { addToPlaylistAction, createPlaylistAction, listPlaylistsAction } from "./music-actions";
import { formatDuration } from "./music-track-list";

/** The three repeat modes, with the labels the buttons show. */
const REPEAT_OPTIONS: readonly { mode: RepeatMode; label: string; title: string }[] = [
  { mode: "off", label: "No repeat", title: "Stop when the queue runs out" },
  { mode: "all", label: "Repeat all", title: "Start the queue again from the top" },
  { mode: "one", label: "Repeat one", title: "Keep replaying the current track" },
];

export function MusicQueueView() {
  const player = useMusicPlayer();
  // Above the early returns below: hooks can't sit after a conditional return.
  const [isSaving, setIsSaving] = useState(false);

  if (player === undefined) {
    return <p className="text-muted">The player is not available on this page.</p>;
  }

  const { queue, currentEntryId, repeatMode, isShuffled, remainingSeconds, isQueueLoading } =
    player;

  if (isQueueLoading) {
    return (
      <div className="rounded-xl border border-line p-8 text-center">
        <p className="text-sm text-muted">Reading the queue...</p>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-line p-8 text-center">
        <p className="font-display text-lg text-ink">The queue is empty</p>
        <p className="mt-2 text-sm text-muted">
          Play anything from the Library, or generate a Magic Playlist, and it lines up
          here. The queue is saved, so it will still be here tomorrow.
        </p>
        <div className="mt-4">
          <Button variant="secondary" href="/modules/music-library">
            Browse the library
          </Button>
        </div>
      </div>
    );
  }

  const currentPosition = queue.findIndex((row) => row.entryId === currentEntryId);

  return (
    <div>
      {/* Toolbar. `flex-wrap` is the whole narrow-screen story: the same controls, on
          two or three lines instead of one. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper-raised p-3">
        <Button
          variant={isShuffled ? "primary" : "secondary"}
          onClick={player.shuffleQueue}
          title="Shuffle everything after the current track"
        >
          Shuffle
        </Button>

        {/* Three buttons rather than a <select>: the current mode is then visible at a
            glance instead of needing the control to be opened. */}
        <div
          className="flex items-center gap-1 rounded-lg border border-line p-1"
          role="group"
          aria-label="Repeat mode"
        >
          {REPEAT_OPTIONS.map((option) => (
            <Button
              key={option.mode}
              size="sm"
              variant={repeatMode === option.mode ? "primary" : "secondary"}
              onClick={() => player.setRepeatMode(option.mode)}
              title={option.title}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <span className="ml-auto text-xs text-muted max-lg:ml-0 max-lg:basis-full">
          {queue.length} {queue.length === 1 ? "track" : "tracks"}
          {remainingSeconds > 0 && ` — ${formatPlayerTime(remainingSeconds)} still to play`}
        </span>

        <Button
          variant="secondary"
          onClick={() => setIsSaving(true)}
          title="Keep this queue as a playlist"
        >
          Save as playlist
        </Button>

        <Button variant="danger" onClick={player.clearQueue} title="Empty the queue">
          Clear
        </Button>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line">
        {queue.map((row, index) => (
          <QueueRowItem
            key={row.entryId}
            row={row}
            index={index}
            isCurrent={row.entryId === currentEntryId}
            // Everything before the cursor has been played. Dimmed rather than hidden:
            // it is still queued, and you can click back to it.
            isPlayed={currentPosition !== -1 && index < currentPosition}
            onPlay={() => player.playEntry(row.entryId)}
            onRemove={() => player.removeFromQueue(row.entryId)}
          />
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted">
        The queue is saved on the server, so it survives a reload and is shared by everyone
        using the app.
      </p>

      {isSaving && (
        <SaveQueueDialog
          trackIds={queue.map((row) => row.trackId)}
          onClose={() => setIsSaving(false)}
        />
      )}
    </div>
  );
}

// Saving the queue: name a new playlist, or append to one that exists.
//
// Both, rather than just "create", because `createPlaylistAction` rejects a duplicate
// name (there is a unique index on it) -- a create-only button would dead-end the moment
// you reused a name, which is exactly what you would do when re-saving a list you are
// still tweaking.
//
// The two server actions here are the ones the library's selection bar already uses. This
// screen is just a different way of choosing the tracks: the whole queue, in queue order,
// rather than a set of ticked rows.
function SaveQueueDialog({
  trackIds,
  onClose,
}: {
  trackIds: readonly number[];
  onClose: () => void;
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [savedTo, setSavedTo] = useState<string | undefined>(undefined);
  const [isBusy, startBusy] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listPlaylistsAction().then((rows) => {
      if (!cancelled) setPlaylists(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One path for both buttons: get a playlist id, then add every queued track to it.
  // `create` is null when appending to an existing list.
  const save = (playlistId: number | null, label: string) =>
    startBusy(async () => {
      setError(undefined);

      let targetId = playlistId;
      if (targetId === null) {
        const created = await createPlaylistAction({ name });
        if ("error" in created) {
          setError(created.error);
          return;
        }
        targetId = created.id;
      }

      const result = await addToPlaylistAction({ playlistId: targetId, trackIds: [...trackIds] });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // Left open on success, showing what happened, rather than closing: the count is
      // the confirmation, and there is nowhere else it could be shown.
      setSavedTo(`Saved ${result.added} ${result.added === 1 ? "track" : "tracks"} to ${label}.`);
    });

  const trimmed = name.trim();

  return (
    <Modal
      title="Save the queue as a playlist"
      description={`${trackIds.length} ${trackIds.length === 1 ? "track" : "tracks"}, in the order they are queued.`}
      onClose={onClose}
      isBusy={isBusy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            {savedTo === undefined ? "Cancel" : "Close"}
          </Button>
          <Button
            onClick={() => save(null, `"${trimmed}"`)}
            disabled={isBusy || trimmed === ""}
          >
            Create playlist
          </Button>
        </>
      }
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">New playlist name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Sunday morning"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
      </label>

      {playlists.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium text-ink">Or add to one you already have</p>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  onClick={() => save(playlist.id, playlist.name)}
                  disabled={isBusy}
                  // 44px row: this is the primary tap target on a phone.
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-brass-soft disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {playlist.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {playlist.trackCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* `text-red-400` rather than a token: there is no `danger` color in the theme
          -- Button's danger variant uses this same fixed red, deliberately, so the
          semantic stays put across themes. */}
      {error !== undefined && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {savedTo !== undefined && <p className="mt-3 text-sm text-brass-dark">{savedTo}</p>}
    </Modal>
  );
}

function QueueRowItem({
  row,
  index,
  isCurrent,
  isPlayed,
  onPlay,
  onRemove,
}: {
  row: QueueRow;
  index: number;
  isCurrent: boolean;
  isPlayed: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={`flex items-center gap-2 pr-2 ${isCurrent ? "bg-brass-soft" : ""}`}>
      <button
        type="button"
        onClick={onPlay}
        disabled={!row.isStreamable}
        className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-brass-soft disabled:cursor-not-allowed disabled:opacity-60 ${
          isPlayed ? "opacity-60" : ""
        }`}
      >
        {/* The position, or a marker on the row that is playing. Fixed width so the
            titles line up whether or not the marker is showing. */}
        <span className="w-6 shrink-0 text-right font-mono text-xs text-brass-dark">
          {isCurrent ? <PlayingGlyph /> : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${isCurrent ? "text-brass-dark" : "text-ink"}`}>
            {row.displayTitle}
          </p>
          <p className="truncate text-xs text-muted">
            {[row.artist, row.album].filter((part) => part !== "").join(" - ") ||
              "Unknown artist"}
          </p>
        </div>

        <span className="font-mono text-xs uppercase text-muted max-lg:hidden">
          {row.extension}
        </span>
        <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">
          {formatDuration(row.durationSeconds)}
        </span>
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${row.displayTitle} from the queue`}
        title="Remove from the queue"
        // 44px touch target on small screens, per design.md.
        className="grid h-11 w-11 place-items-center rounded text-muted hover:text-ink"
      >
        <RemoveGlyph />
      </button>
    </li>
  );
}

/** A small speaker, marking the row that is playing. */
function PlayingGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-3.5 w-3.5 fill-current"
      aria-label="Now playing"
      role="img"
    >
      <path d="M4 9h3l4-4v14l-4-4H4zm11.5-2.5a5 5 0 010 11v-2a3 3 0 000-7z" />
    </svg>
  );
}

function RemoveGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z" />
    </svg>
  );
}
