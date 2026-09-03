// A full-screen viewer for one FOLDER of photographs: a big stage on top, a strip of
// thumbnails below, and a "Slide show" panel that sets the pace and the transition.
//
// Distinct from `PhotoLightbox`, which shows a SET the caller has already assembled and
// is the right choice for "enlarge this one picture". This component's subject is the
// folder — it is handed a folder path and finds out for itself what is inside, so a
// reader who arrives on one photo can browse the other four hundred beside it.
//
// Pure presentation still: it does no I/O of its own. `onListFolder` is injected by the
// page, exactly as `PhotoOfTheDay` takes its lookups, which is what keeps this file free
// of any filesystem, archive or server-action type.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  DEFAULT_SLIDESHOW_OPTIONS,
  SLIDESHOW_EFFECT_CHOICES,
  SLIDESHOW_INTERVAL_CHOICES,
  slideshowIntervalMs,
  type SlideshowEffect,
  type SlideshowOptions,
} from "@/lib/journal-photos";

/** One photo in the folder. A type, not a record — the caller maps its own data in. */
export interface ViewerPhoto {
  /** File name, shown in the caption and used as the alt text. */
  name: string;
  /** Path from the photo root, which `photoUrl` turns into a URL. */
  relativePath: string;
}

/**
 * What `onListFolder` resolves to.
 *
 * Declared here rather than imported from the action, so `src/components/` keeps no
 * dependency on `src/app/`. The action's own result type is structurally identical and
 * assignable to this — the same arrangement `PhotoOfTheDay` uses.
 */
export interface ViewerFolderOutcome {
  ok: boolean;
  photos?: ViewerPhoto[];
  error?: string;
}

export interface PhotosViewerProps {
  /** The folder to browse, as a path from the photo root. */
  folderPath: string;
  /**
   * Which photo opens first, as a path from the photo root.
   *
   * Optional: without it the viewer opens on the first photo in the folder. With it the
   * reader lands on the picture they clicked, which is the point when the viewer is
   * opened from a card already showing one.
   */
  initialPhotoPath?: string;
  /**
   * Reads the folder. Injected, so this component fetches nothing itself.
   *
   * PASS A STABLE REFERENCE — a module-scope server action, or one wrapped in
   * `useCallback`. The load effect depends on it, so an inline arrow defined in the
   * caller's render body is a new function every render and would re-read the folder in
   * a loop.
   */
  onListFolder: (folderPath: string) => Promise<ViewerFolderOutcome>;
  /** Builds the URL for one photo's bytes. */
  photoUrl: (relativePath: string) => string;
  /** Raised on Escape and on the close button. */
  onClose: () => void;
  /**
   * A friendlier name for the folder, shown above the file name.
   *
   * The caller usually has one already (the archive's folder names carry a date and an
   * event). Falls back to the last segment of `folderPath`.
   */
  folderLabel?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * How many thumbnails are mounted at once.
 *
 * THE REASON THIS LIMIT EXISTS: there is no thumbnail pipeline. The archive's port is
 * read-only and forbids writing a cache into it, so a "thumbnail" here is the original
 * multi-megabyte JPEG scaled down by the browser. Mounting a 1,187-photo folder's worth
 * would queue 1,187 full-size reads over an SMB share and stall the strip for minutes.
 *
 * So the strip is a WINDOW around the current photo rather than the whole folder. It
 * still scrolls the full width — every photo has a slot, keeping the scrollbar honest
 * about how big the folder is — but only the slots near the reader hold an `<img>`.
 * Moving through the folder slides the window along, so the pictures ahead are already
 * loading by the time they are reached.
 */
const THUMBNAIL_WINDOW = 24;

/** The two selects share this, so the panel's controls cannot drift apart. */
const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function PhotosViewer({
  folderPath,
  initialPhotoPath,
  onListFolder,
  photoUrl,
  onClose,
  folderLabel,
  className = "",
}: PhotosViewerProps) {
  const [photos, setPhotos] = useState<ViewerPhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  // Slideshow state. Options are NOT persisted — a freshly opened viewer always starts
  // from the defaults, so nobody wonders why tonight's slideshow inherited last month's
  // pace. `isPlaying` lives here rather than in the options because it is not a
  // preference, it is what the viewer is doing right now.
  const [options, setOptions] = useState<SlideshowOptions>(DEFAULT_SLIDESHOW_OPTIONS);
  const [isPlaying, setIsPlaying] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);

  // Reads the folder once per folder. The effect owns an `isStale` flag rather than an
  // AbortController: the action is a server call whose result we simply stop applying,
  // and a reader who reopens on a different folder must not see the first one's photos
  // arrive late and win.
  useEffect(() => {
    let isStale = false;
    setIsLoading(true);
    setError(undefined);

    void onListFolder(folderPath).then((outcome) => {
      if (isStale) return;
      setIsLoading(false);

      if (!outcome.ok || outcome.photos === undefined) {
        setError(outcome.error ?? "Couldn't read that folder.");
        setPhotos([]);
        return;
      }

      setPhotos(outcome.photos);
      // Land on the photo the reader clicked. `findIndex` rather than trusting a
      // caller-supplied number, because the folder listing is the only thing that knows
      // the order — and a photo deleted since the card drew it simply is not found,
      // which falls back to the start of the folder rather than an empty stage.
      const found =
        initialPhotoPath === undefined
          ? -1
          : outcome.photos.findIndex((photo) => photo.relativePath === initialPhotoPath);
      setIndex(found >= 0 ? found : 0);
    });

    return () => {
      isStale = true;
    };
  }, [folderPath, initialPhotoPath, onListFolder]);

  const photo = photos[index];
  const hasPrevious = index > 0;
  const hasNext = index < photos.length - 1;

  // Both manual steps stop the slideshow, the same rule `PhotoLightbox` follows: taking
  // hold of the arrows means looking at this one properly, and a timer pulling the photo
  // away two seconds later is the opposite of what was asked.
  const goPrevious = useCallback(() => {
    setIsPlaying(false);
    setIndex((current) => (current > 0 ? current - 1 : current));
  }, []);

  const goNext = useCallback(() => {
    setIsPlaying(false);
    setIndex((current) => current + 1);
  }, []);

  const goTo = useCallback((target: number) => {
    setIsPlaying(false);
    setIndex(target);
  }, []);

  // Bound on the document, not a focused element: the viewer is opened by clicking a
  // button elsewhere, so there is no reliable focus target and the arrow keys have to
  // work without the reader clicking the stage first.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") goPrevious();
      else if (event.key === "ArrowRight") {
        // Guarded here rather than inside `goNext`, which the timer also calls.
        if (index < photos.length - 1) goNext();
      } else return;
      event.preventDefault();
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, goPrevious, goNext, index, photos.length]);

  // The page behind must not scroll while the viewer is up — on a phone a swipe would
  // otherwise move the home screen underneath instead of doing nothing.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // The slideshow timer. One `setTimeout` keyed on the index rather than a repeating
  // interval, so every photo — including one arrived at by hand — gets a full interval,
  // and there is no long-lived schedule to drift out of step with what is on screen.
  //
  // It advances with `setIndex` directly, NOT `goNext`, which pauses on purpose: a timer
  // that paused itself would show exactly two photos.
  useEffect(() => {
    if (!isPlaying || photos.length === 0) return;

    // The last photo ends the run rather than wrapping, matching `PhotoLightbox`:
    // leaving it going finishes on a still picture instead of looping all evening.
    if (index >= photos.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => setIndex(index + 1), slideshowIntervalMs(options));
    return () => window.clearTimeout(timer);
  }, [isPlaying, index, photos.length, options]);

  // Keeps the current thumbnail in view. Needed because the index also moves on its own
  // during a slideshow, and a strip that stayed put would show the reader a row of
  // thumbnails unrelated to the photo on the stage. `block: "nearest"` so it scrolls the
  // strip and never the page.
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  // Mounted into document.body via a portal, NOT inline where it is used: `fixed
  // inset-0 z-50` is only as good as its stacking context, and rendered inside a
  // home-screen card this would come out behind the app's own `z-40` header. The
  // `document` guard covers the server render, where there is no body to portal into.
  if (typeof document === "undefined") return null;

  const label = folderLabel ?? folderPath.split("/").pop() ?? folderPath;

  return createPortal(
    <div
      // `no-print`: a printed page is the page, not a screen overlay. Fully opaque
      // rather than a translucent scrim — this is a photo viewer, and the page showing
      // through behind a picture is a distraction rather than useful context.
      className={`no-print fixed inset-0 z-50 flex flex-col bg-black ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Photos in ${label}`}
    >
      {/* The header carries its own opaque background: the app's `z-40` bar sits exactly
          here, and at anything less than opaque its nav links read straight through. */}
      <div className="flex items-start justify-between gap-3 bg-black px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm text-white/60">{label}</p>
          <p className="truncate font-mono text-sm">{photo?.name ?? ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {photos.length > 0 && (
            <span className="text-xs text-white/60">
              {index + 1} / {photos.length}
            </span>
          )}
          {/* Large tap target: this is the primary way out on a phone, where there is no
              Escape key and the stage covers the screen. */}
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

      {/* The stage. `min-h-0` is what lets it shrink instead of pushing the strip off the
          bottom — a flex child's default `min-height: auto` would let a tall photo win
          the argument with the thumbnails. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {isLoading ? (
          <p className="text-sm text-white/60">Reading the folder…</p>
        ) : error !== undefined ? (
          <p className="max-w-md text-center text-sm text-red-300">{error}</p>
        ) : photo === undefined ? (
          <p className="text-sm text-white/60">There are no photographs in this folder.</p>
        ) : (
          <>
            {/* Keyed on the path so React remounts the image when the photo changes,
                which is what lets a CSS entry animation run again. Without the key the
                same element would swap its `src` and no transition would play. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- the bytes come from
                our own session-gated route over a NAS share, not a static asset
                next/image can optimize. */}
            <img
              key={photo.relativePath}
              src={photoUrl(photo.relativePath)}
              alt={photo.name}
              className={`max-h-full max-w-full object-contain ${effectClass(options.effect)}`}
            />

            {hasPrevious && <NavButton side="left" label="Previous photo" onClick={goPrevious} />}
            {hasNext && <NavButton side="right" label="Next photo" onClick={goNext} />}
          </>
        )}
      </div>

      {/* The lower half: thumbnails, then the slideshow panel. Both are `shrink-0` so the
          stage above is the part that gives way on a short screen. */}
      <div className="shrink-0 bg-black px-4 pb-4 pt-3">
        {photos.length > 1 && (
          <div
            ref={stripRef}
            // A single scrolling row, not a wrapping grid: the strip's job is "where am I
            // in this folder", which a line preserves and a block of rows loses.
            className="mb-3 flex gap-2 overflow-x-auto pb-2"
          >
            {photos.map((candidate, candidateIndex) => {
              const isActive = candidateIndex === index;
              // Every photo gets a slot so the scrollbar reflects the real folder size,
              // but only those near the reader hold an image. See THUMBNAIL_WINDOW.
              const isInWindow = Math.abs(candidateIndex - index) <= THUMBNAIL_WINDOW / 2;

              return (
                <button
                  key={candidate.relativePath}
                  type="button"
                  data-active={isActive}
                  onClick={() => goTo(candidateIndex)}
                  title={candidate.name}
                  aria-label={candidate.name}
                  aria-current={isActive}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors max-lg:h-12 max-lg:w-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    isActive ? "border-white" : "border-white/20 hover:border-white/50"
                  }`}
                >
                  {isInWindow ? (
                    // eslint-disable-next-line @next/next/no-img-element -- as above.
                    <img
                      src={photoUrl(candidate.relativePath)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // A placeholder, not an image: this slot exists to hold the strip's
                    // width open, and loading it would defeat the window entirely.
                    <span className="block h-full w-full bg-white/10" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {photos.length > 0 && (
          // Collapsed by default: the pictures are the point, and a settings panel
          // sitting open under every photo would be the loudest thing on a phone.
          <CollapsibleCard title="Slide show">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="mb-1 block text-muted">Seconds per photo</span>
                <select
                  value={options.intervalSeconds}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      intervalSeconds: Number(event.target.value),
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  {SLIDESHOW_INTERVAL_CHOICES.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-muted">Transition</span>
                <select
                  value={options.effect}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      effect: event.target.value as SlideshowEffect,
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  {SLIDESHOW_EFFECT_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* One button that starts and stops, rather than two: what it does next is
                  the only thing a reader needs from it, and a disabled Stop beside an
                  active Start is two controls saying one thing. */}
              <button
                type="button"
                onClick={() => {
                  // Starting on the last photo would stop immediately, so it restarts
                  // from the top instead — the reader plainly meant "play the folder".
                  if (!isPlaying && index >= photos.length - 1) setIndex(0);
                  setIsPlaying(!isPlaying);
                }}
                disabled={photos.length < 2}
                className="rounded-md bg-brass px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brass-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                {isPlaying ? "Stop slide show" : "Start slide show"}
              </button>
            </div>
          </CollapsibleCard>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The entry animation for the chosen effect.
 *
 * A class on a remounted `<img>` rather than two stacked images cross-fading: the
 * pictures here are multi-megabyte NAS reads, and holding the outgoing one mounted to
 * fade it out would double what is in flight. So "cross-fade" is honestly a fade-in over
 * black, which at these sizes is what a reader sees anyway.
 */
function effectClass(effect: SlideshowEffect): string {
  switch (effect) {
    case "fade":
      return "animate-photo-fade";
    case "slide":
      return "animate-photo-slide";
    default:
      return "";
  }
}

/**
 * One of the two edge arrows. Absolutely positioned over the stage and sized for a thumb
 * — a small arrow at a screen edge is the control people miss on a phone.
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
      onClick={onClick}
      className={`absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
