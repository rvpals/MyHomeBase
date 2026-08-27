"use client";

// The persistent player bar: what is playing, wherever you are in the app.
//
// Mounted once by the protected layout, next to the provider that owns the <audio>
// element. Renders nothing at all when there is no current track, so it costs no
// space until the first play.
//
// Narrow screens get a genuinely different component rather than a restyle -- a
// single row of cover, title, play/pause, queue and close, with the scrubber as a
// hairline at the very top edge. That is the `useIsCompact()` case design.md describes: a desktop
// transport row with a full scrubber and volume does not shrink into 375px, it has to
// be a different arrangement.

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { useIsCompact } from "@/components/viewport-context";
import {
  albumCoverUrl,
  formatPlayerTime,
  useMusicPlayer,
} from "@/components/music-player-provider";

export function MusicPlayerBar() {
  const player = useMusicPlayer();
  const isCompact = useIsCompact();

  // Which shape is on screen, or null for nothing playing. Computed before the
  // early return below because the effect that publishes it is a hook, and hooks
  // can't sit after a conditional return.
  const shape =
    player === undefined || player.current === undefined
      ? null
      : isCompact
        ? "compact"
        : "full";

  // Mirrored onto <html> so globals.css can reserve `.app-main` padding for the
  // bar — the same seam `TreeNav` uses for `data-treenav`, and for the same
  // reason: the layout that owns `.app-main` is a server component and can't see
  // whether a track is loaded. The bar's *offset* is CSS's business too, since it
  // parks above whatever the nav is occupying.
  useEffect(() => {
    const root = document.documentElement;
    if (shape) {
      root.dataset.musicPlayer = shape;
    } else {
      delete root.dataset.musicPlayer;
    }
    return () => {
      delete root.dataset.musicPlayer;
    };
  }, [shape]);

  if (player === undefined || player.current === undefined) return null;

  const { current, isPlaying, position, duration, queue, toggle, next, previous, seek, stop } = player;
  const coverUrl = albumCoverUrl(current.albumId);
  const total = duration > 0 ? duration : (current.durationSeconds ?? 0);
  const fraction = total > 0 ? Math.min(position / total, 1) : 0;

  if (isCompact) {
    return (
      <div className="music-player-pinned border-t border-line bg-paper-raised">
        {/* The scrubber is a hairline here: a 44px-tall slider would eat the row. */}
        <div className="h-0.5 w-full bg-line">
          <div className="h-full bg-brass" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className="flex items-center gap-3 px-3 py-2">
          <Cover url={coverUrl} title={current.title} size="h-10 w-10" />
          <Link
            href={`/modules/music-library/player`}
            className="min-w-0 flex-1"
            aria-label="Open the player"
          >
            <p className="truncate text-sm text-ink">{current.title}</p>
            <p className="truncate text-xs text-muted">{current.artist || "Unknown artist"}</p>
          </Link>
          <TransportButton onClick={toggle} label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </TransportButton>
          <QueueButton count={queue.length} />
          <TransportButton onClick={stop} label="Close the player">
            <CloseGlyph />
          </TransportButton>
        </div>
      </div>
    );
  }

  return (
    <div className="music-player-pinned border-t border-line bg-paper-raised px-4 py-2">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <Cover url={coverUrl} title={current.title} size="h-12 w-12" />

        <div className="min-w-0 w-56">
          <Link href={`/modules/music-library/player`} className="block min-w-0">
            <p className="truncate text-sm text-ink">{current.title}</p>
            <p className="truncate text-xs text-muted">{current.artist || "Unknown artist"}</p>
          </Link>
        </div>

        <div className="flex items-center gap-1">
          <TransportButton onClick={previous} label="Previous track">
            <PreviousGlyph />
          </TransportButton>
          <TransportButton onClick={toggle} label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </TransportButton>
          <TransportButton onClick={next} label="Next track">
            <NextGlyph />
          </TransportButton>
        </div>

        <span className="font-mono text-xs text-muted">{formatPlayerTime(position)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          step={1}
          value={Math.min(position, total)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Seek"
          className="h-1 flex-1 accent-brass"
        />
        <span className="font-mono text-xs text-muted">{formatPlayerTime(total)}</span>

        <QueueButton count={queue.length} />

        <Button size="sm" variant="secondary" onClick={stop}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * Opens the Queue screen, with how many tracks are lined up.
 *
 * A link rather than a popover: the queue is a real route (`/modules/music-library/queue`),
 * so it is bookmarkable and survives a reload -- and a 60-track list does not belong in a
 * panel hanging off a 48px-tall bar.
 */
function QueueButton({ count }: { count: number }) {
  return (
    <Link
      href="/modules/music-library/queue"
      aria-label={`Show the queue, ${count} ${count === 1 ? "track" : "tracks"}`}
      title="Show the queue"
      // Same 44px touch target as the transport buttons, per design.md.
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink hover:bg-brass-soft"
    >
      <QueueGlyph />
      {count > 1 && (
        // The count, only when there is more than the current track -- a badge reading
        // "1" on a queue of one tells the listener nothing.
        <span className="absolute -right-0.5 top-0.5 rounded-full bg-brass px-1 font-mono text-[10px] leading-tight text-paper">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function QueueGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      {/* Three stacked lines and a play triangle: a list with something playing off it. */}
      <path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm0 4h8v2H3zm12-1V9l6 4z" />
    </svg>
  );
}

function Cover({ url, title, size }: { url?: string; title: string; size: string }) {
  if (url === undefined) {
    return (
      <div
        className={`${size} shrink-0 rounded border border-line bg-paper`}
        aria-hidden="true"
      />
    );
  }
  // A plain <img>: nothing in this app imports next/image (publish-nas.mjs notes sharp
  // is never loaded), and these bytes come from our own route already sized small.
  return (
    <img
      src={url}
      alt={`Cover art for ${title}`}
      className={`${size} shrink-0 rounded border border-line object-cover`}
    />
  );
}

function TransportButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // 44px minimum touch target on small screens, per design.md.
      className="grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-brass-soft max-lg:h-11 max-lg:w-11"
    >
      {children}
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L12 13.4l-6.3 6.3-1.4-1.4L10.6 12 4.3 5.7l1.4-1.4L12 10.6l6.3-6.3z" />
    </svg>
  );
}

function PreviousGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M7 5h2v14H7zm3 7l9-7v14z" />
    </svg>
  );
}

function NextGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M15 5h2v14h-2zM5 5l9 7-9 7z" />
    </svg>
  );
}
