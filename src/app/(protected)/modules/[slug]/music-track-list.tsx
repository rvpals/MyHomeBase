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
  onMove,
  numbered = false,
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
  /**
   * Present only inside a playlist, which is the one view with an order of its own --
   * every other view is sorted by the query. Arrows rather than drag-and-drop: they
   * need no new dependency and stay tappable on a phone, matching the widget list on
   * the Stocks configuration screen.
   */
  onMove?: (row: TrackListRow, direction: "up" | "down") => void;
  /**
   * Position badges, each track's duration as a badge, and alternating row tints --
   * the "this is an ordered programme" treatment.
   *
   * Opt-in rather than the default because the eight browsing views are *not* ordered
   * in any meaningful sense: their order is whatever the query returned, so numbering
   * All Songs 1..50 would assert a sequence that resorting silently invalidates. The
   * Magic Playlist is the one view whose order is the product -- it was generated to
   * be played top to bottom -- so it is the one view that earns the numbers.
   */
  numbered?: boolean;
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
      {rows.map((row, index) => {
        const isCurrent = player?.current?.id === row.id;
        return (
          // The tint goes on the `li` so it spans the whole row including the move
          // arrows and Remove, not just the play button. `bg-paper-raised` on odd rows
          // only -- the even rows keep the card's own background rather than both rows
          // being painted, so the banding reads as a stripe rather than a second card.
          // The current track's `bg-brass-soft` is painted on the button above this, so
          // it still wins where it matters.
          <li
            key={`${row.id}-${row.displayTitle}`}
            className={`flex items-center gap-2 pr-2 ${
              numbered && index % 2 === 1 ? "bg-paper-raised" : ""
            }`}
          >
            {onMove !== undefined && (
              <span className="ml-2 flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => onMove(row, "up")}
                  disabled={index === 0}
                  aria-label={`Move ${row.displayTitle} up`}
                  className="rounded border border-line px-1.5 text-xs leading-4 text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(row, "down")}
                  disabled={index === rows.length - 1}
                  aria-label={`Move ${row.displayTitle} down`}
                  className="rounded border border-line px-1.5 text-xs leading-4 text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
            )}
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
              {numbered && (
                // `min-w-*` rather than a fixed `w-*`: a three-digit position in a long
                // playlist must widen the pill instead of spilling out of it. Centred
                // and tabular so the numbers line up down the column regardless.
                <span className="inline-flex min-w-7 shrink-0 justify-center rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brass-dark">
                  {index + 1}
                </span>
              )}
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
              {numbered ? (
                // An empty string from `formatDuration` (unknown length) must not paint
                // an empty pill, so the badge is conditional on there being a figure.
                formatDuration(row.durationSeconds) !== "" && (
                  <span className="shrink-0 rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brass-dark">
                    {formatDuration(row.durationSeconds)}
                  </span>
                )
              ) : (
                <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">
                  {formatDuration(row.durationSeconds)}
                </span>
              )}
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
