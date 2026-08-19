"use client";

// The track list, shared by every one of the Library's eight views.
//
// Extracted rather than duplicated per view: All Songs, a single artist, a genre, a year,
// a folder, Most Played and a playlist all show the same thing -- an ordered list of
// tracks you can click to play. Only the heading and the source query differ.
//
// Narrow screens restyle with `max-lg:` rather than switching component: it is the same
// list either way, just one column with the metadata stacked.

import { Button } from "@/components/button";
import { useMusicPlayer, type PlayableTrack } from "@/components/music-player-provider";
import { recordPlayAction } from "./music-actions";

export interface TrackListRow {
  id: number;
  displayTitle: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
  extension: string;
  isStreamable: boolean;
  playCount?: number;
}

export function TrackList({
  rows,
  emptyMessage,
  showPlayCount = false,
  selectable = false,
  selected,
  onToggleSelected,
  onRemove,
}: {
  rows: TrackListRow[];
  emptyMessage: string;
  /** Most Played shows the count; nowhere else needs the column. */
  showPlayCount?: boolean;
  /** Playlist building needs checkboxes; browsing does not. */
  selectable?: boolean;
  selected?: Set<number>;
  onToggleSelected?: (trackId: number) => void;
  /** Present only inside a playlist, where a row can be taken out of the list. */
  onRemove?: (row: TrackListRow) => void;
}) {
  const player = useMusicPlayer();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line p-6">
        <p className="text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const play = (row: TrackListRow) => {
    if (player === undefined || !row.isStreamable) return;
    // The visible list becomes the queue, so "next" walks what you are looking at.
    const queue: PlayableTrack[] = rows.filter((entry) => entry.isStreamable).map(toPlayable);
    player.play(toPlayable(row), queue);
    // Fire-and-forget: a failed count must never stop the music. "Started" is the chosen
    // definition of a play -- see migrations/0056.
    void recordPlayAction(row.id);
  };

  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {rows.map((row) => {
        const isCurrent = player?.current?.id === row.id;
        return (
          <li key={`${row.id}-${row.displayTitle}`} className="flex items-center gap-2 pr-2">
            {selectable && (
              <input
                type="checkbox"
                checked={selected?.has(row.id) ?? false}
                onChange={() => onToggleSelected?.(row.id)}
                aria-label={`Select ${row.displayTitle}`}
                className="ml-3 accent-brass"
              />
            )}
            <button
              type="button"
              onClick={() => play(row)}
              disabled={!row.isStreamable}
              className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-brass-soft disabled:cursor-not-allowed disabled:opacity-60 ${
                isCurrent ? "bg-brass-soft" : ""
              }`}
            >
              {showPlayCount && (
                <span className="w-10 shrink-0 text-right font-mono text-xs text-brass-dark">
                  {row.playCount ?? 0}x
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{row.displayTitle}</p>
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
            {onRemove !== undefined && (
              <button
                type="button"
                onClick={() => onRemove(row)}
                aria-label={`Remove ${row.displayTitle} from this playlist`}
                className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
              >
                Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Previous/next pager, shared by the paged views. */
export function Pager({
  offset,
  shown,
  totalCount,
  pageSize,
  isLoading,
  onOffsetChange,
}: {
  offset: number;
  shown: number;
  totalCount: number;
  pageSize: number;
  isLoading: boolean;
  onOffsetChange: (offset: number) => void;
}) {
  const last = Math.min(offset + shown, totalCount);
  if (totalCount <= pageSize) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button
        variant="secondary"
        disabled={offset === 0 || isLoading}
        onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
      >
        Previous
      </Button>
      <span className="text-xs text-muted">
        {offset + 1}-{last} of {totalCount.toLocaleString()}
      </span>
      <Button
        variant="secondary"
        disabled={last >= totalCount || isLoading}
        onClick={() => onOffsetChange(offset + pageSize)}
      >
        Next
      </Button>
    </div>
  );
}

function toPlayable(row: TrackListRow): PlayableTrack {
  return {
    id: row.id,
    title: row.displayTitle,
    artist: row.artist,
    album: row.album,
    albumId: row.albumId,
    durationSeconds: row.durationSeconds,
  };
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
