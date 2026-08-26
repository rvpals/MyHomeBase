// A full-screen overlay showing one photo at a time, with keyboard and on-screen
// navigation through a set.
//
// Pure presentation: it takes a list of image URLs plus the index to show, and raises
// intent (close, move to index N). It does no fetching and knows nothing about where
// the photos came from — the journal's picture card supplies URLs from its own route,
// and anything else with a set of images can reuse it unchanged.

"use client";

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

export interface LightboxPhoto {
  /** Image URL, already built by the caller. */
  src: string;
  /** Shown in the caption bar and used as the alt text. */
  caption: string;
  /** Optional second line, e.g. which folder the photo came from. */
  subcaption?: string;
}

export interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  /** Index into `photos` currently shown. Out-of-range renders nothing. */
  index: number;
  /** Raised with the index to move to. The caller clamps or wraps as it prefers. */
  onIndexChange: (index: number) => void;
  /** Raised on Escape, on the close button, and on a click of the backdrop. */
  onClose: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  className = "",
}: PhotoLightboxProps) {
  const photo = photos[index];
  const hasPrevious = index > 0;
  const hasNext = index < photos.length - 1;

  const goPrevious = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);

  const goNext = useCallback(() => {
    if (index < photos.length - 1) onIndexChange(index + 1);
  }, [index, photos.length, onIndexChange]);

  // Keys are bound on the document rather than on a focused element: the overlay is
  // opened by clicking a thumbnail somewhere else, so there is no reliable focus
  // target, and arrow keys have to work without the user clicking the overlay first.
  useEffect(() => {
    if (photo === undefined) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") goPrevious();
      else if (event.key === "ArrowRight") goNext();
      else return;
      // Only for keys actually handled, so an unrelated shortcut still works.
      event.preventDefault();
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [photo, onClose, goPrevious, goNext]);

  // The page behind must not scroll while the overlay is up — on a phone a swipe
  // would otherwise move the entry underneath instead of doing nothing.
  useEffect(() => {
    if (photo === undefined) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [photo]);

  // Mounted into document.body via a portal, NOT inline where it is used.
  //
  // `fixed inset-0 z-50` is only as good as its stacking context: rendered inside a
  // card, the overlay came out *behind* the app's own `z-40` top bar, whose nav links
  // showed through the caption. A portal takes the overlay out of whatever the caller
  // happens to be nested in, so it covers the whole screen wherever it is used.
  //
  // The `document` guard covers the server render, where there is no body to portal
  // into. No mount-flag state is needed: this overlay only ever appears in response to
  // a click, so there is no first-paint case where it should already be open.
  if (photo === undefined || typeof document === "undefined") return null;

  return createPortal(
    <div
      // `no-print`: a printed journal entry is the entry, not a screen overlay.
      // Fully opaque, not a translucent scrim: this is a photo viewer, and the page
      // showing through behind an image is a distraction rather than useful context.
      className={`no-print fixed inset-0 z-50 flex flex-col bg-black ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption}
      // Clicking the backdrop closes; the image and the bars stopPropagation so a
      // click on them (or a drag to pan) doesn't dismiss the photo.
      onClick={onClose}
    >
      {/* The caption bar carries its OWN opaque background, not just the overlay's.
          The app's `z-40` top bar sits exactly here, and at `bg-black/90` its nav
          links read straight through the caption — legible enough to look like a
          rendering bug. Opaque black settles it without touching the app bar. */}
      <div
        className="flex items-start justify-between gap-3 bg-black px-4 py-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate font-mono text-sm">{photo.caption}</p>
          {photo.subcaption && (
            <p className="truncate text-xs text-white/60">{photo.subcaption}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-white/60">
            {index + 1} / {photos.length}
          </span>
          {/* Large tap target: this is the primary way out on a phone, where there
              is no Escape key and the backdrop is mostly covered by the image. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl leading-none text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- the bytes come from
            our own session-gated route over a NAS share, not a static asset
            next/image can optimize. */}
        <img
          src={photo.src}
          alt={photo.caption}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />

        {hasPrevious && (
          <NavButton side="left" label="Previous photo" onClick={goPrevious} />
        )}
        {hasNext && <NavButton side="right" label="Next photo" onClick={goNext} />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * One of the two edge arrows. Absolutely positioned over the image area and sized for
 * a thumb — a small arrow at a screen edge is the control people miss on a phone.
 */
function NavButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
