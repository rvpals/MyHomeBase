"use client";

// The persistent player bar: what is playing, wherever you are in the app.
//
// Mounted once by the protected layout, next to the provider that owns the <audio>
// element. Renders nothing at all when there is no current track, so it costs no
// space until the first play.
//
// Narrow screens get a genuinely different component rather than a restyle -- a
// single row of cover, title and play/pause, with the scrubber as a hairline at the
// very top edge. That is the `useIsCompact()` case design.md describes: a desktop
// transport row with a full scrubber and volume does not shrink into 375px, it has to
// be a different arrangement.

import Link from "next/link";
import { useIsCompact } from "@/components/viewport-context";
import {
  albumCoverUrl,
  formatPlayerTime,
  useMusicPlayer,
} from "@/components/music-player-provider";

export function MusicPlayerBar() {
  const player = useMusicPlayer();
  const isCompact = useIsCompact();

  if (player === undefined || player.current === undefined) return null;

  const { current, isPlaying, position, duration, toggle, next, previous, seek, stop } = player;
  const coverUrl = albumCoverUrl(current.albumId);
  const total = duration > 0 ? duration : (current.durationSeconds ?? 0);
  const fraction = total > 0 ? Math.min(position / total, 1) : 0;

  if (isCompact) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-raised">
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
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-raised px-4 py-2">
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

        <button
          type="button"
          onClick={stop}
          className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
        >
          Close
        </button>
      </div>
    </div>
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
