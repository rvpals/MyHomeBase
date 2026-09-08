// THE photograph viewer. A full-screen stage, a thumbnail strip, a slide show, the
// capture details, a Journal link and a favourite heart.
//
// One component, replacing the two that used to split this job (`PhotoLightbox`, which
// took a set the caller had assembled, and `PhotosViewer`, which read a folder itself).
// They diverged on features rather than on purpose: the folder one grew the strip, the
// heart and the Journal link, the set one grew the play/pause control -- and a reader
// clicking a photograph got whichever the call site happened to use, with no way to tell
// why the good one was behind a small folder glyph. Merging them is what makes "enlarge
// this picture" and "browse this folder" the same experience.
//
// HOW IT GETS ITS PHOTOS -- exactly one of two ways, enforced by the props union:
//
//   photos={[...]}                     the caller assembled the set
//   folderPath=... onListFolder=...    the component reads the folder itself
//
// The union is what stops this being a two-mode blob: a caller cannot pass both or
// neither and still typecheck, so every call site is one shape or the other and the
// branch inside is a single `useEffect`.
//
// It owns its index and play state either way. That is the difference between a viewer
// and a controlled overlay, and it is why the callers that used to hold `lightboxIndex`
// no longer need to -- `initialIndex` and `autoPlay` set the opening state, and the
// viewer owns it after that.
//
// Still pure presentation: every read is an injected callback. No filesystem, archive or
// server-action type appears in this file, which is what keeps `src/components/` free of
// any dependency on `src/app/`.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import { TreeIcon } from "@/components/tree-icons";
import {
  DEFAULT_SLIDESHOW_OPTIONS,
  SLIDESHOW_EFFECT_CHOICES,
  SLIDESHOW_INTERVAL_CHOICES,
  photoJournalDate,
  slideshowIntervalMs,
  type SlideshowEffect,
  type SlideshowOptions,
} from "@/lib/journal-photos";

/** One photo in the viewer. A type, not a record — the caller maps its own data in. */
export interface ViewerPhoto {
  /** File name, shown in the caption and used as the alt text. */
  name: string;
  /** Path from the photo root, which `photoUrl` turns into a URL. */
  relativePath: string;
  /**
   * A better caption than the file name, when the caller has one.
   *
   * Exists because the favourites screen captions with the NOTE the reader wrote — that
   * is what they said about the picture, and `IMG_20190609_143501.jpg` is not. Falls
   * back to `name`, which is what a folder browse wants.
   */
  caption?: string;
  /** A second caption line, e.g. which folder the photo came from. */
  subcaption?: string;
}

/**
 * What `onListFolder` resolves to.
 *
 * Declared here rather than imported from the action, so `src/components/` keeps no
 * dependency on `src/app/`. The action's own result type is structurally identical and
 * assignable to this.
 */
export interface ViewerFolderOutcome {
  ok: boolean;
  photos?: ViewerPhoto[];
  error?: string;
}

/**
 * What `onPhotoDetails` resolves to — where the photo is, and when it was taken.
 *
 * Structurally matches the action's `PhotoDetailsResult`, declared here for the same
 * boundary reason as `ViewerFolderOutcome`.
 */
export interface ViewerPhotoDetails {
  ok: boolean;
  details?: {
    relativePath: string;
    takenAtDate?: string;
    takenAtTime?: string;
    /** `exif` is the camera's own record; the rest are inferred from names. */
    takenAtSource: "exif" | "file-name" | "folder" | "none";
  };
  error?: string;
}

/** Props shared by both ways of supplying photos. */
interface PhotoViewerCommonProps {
  /** Builds the URL for one photo's bytes. */
  photoUrl: (relativePath: string) => string;
  /** Raised on Escape and on the close button. */
  onClose: () => void;
  /**
   * Which photo to open on, as an index into the set.
   *
   * For a caller-supplied set only — a folder read has no stable index before it
   * resolves, so use `initialPhotoPath` there. Out of range falls back to the first
   * photo rather than an empty stage.
   */
  initialIndex?: number;
  /**
   * Open with the slide show already running.
   *
   * This is what lets a "Slideshow" button elsewhere on the page hand over to the
   * viewer mid-gesture. Read ONCE at mount: the viewer owns the play state afterwards,
   * so this is not a way to drive it from outside.
   */
  autoPlay?: boolean;
  /**
   * Reads the full path and capture timestamp of the photo on the stage.
   *
   * LAZY AND PER PHOTO, which is the whole reason it is a callback rather than a field
   * on `ViewerPhoto`. Reading EXIF means opening a file over SMB; doing it for a
   * 1,187-photo folder up front would stall the viewer for minutes, while doing it for
   * the one picture someone is looking at is invisible.
   *
   * Omit to hide the details line entirely. Must be a STABLE REFERENCE — a module-scope
   * server action or a `useCallback` — since a fetch effect depends on it.
   */
  onPhotoDetails?: (relativePath: string) => Promise<ViewerPhotoDetails>;
  /**
   * Whether the photo on the stage is a kept one.
   *
   * A PREDICATE rather than a list of paths, because the viewer moves through hundreds
   * of pictures and the caller already holds the favourites it read for its own screen
   * — so this is a `useCallback` over that list, and the viewer keeps no second copy to
   * fall out of step with it.
   *
   * Optional, and only half a pair: the heart is rendered only when BOTH this and
   * `onToggleFavorite` are given, so a caller with no notion of favourites gets a
   * viewer with no favourite control rather than a dead one.
   */
  isFavorite?: (relativePath: string) => boolean;
  /**
   * Flips the favourite for one path.
   *
   * MUST NOT RESOLVE UNTIL `isFavorite` WOULD RETURN THE NEW ANSWER — that is the
   * contract this leans on. The viewer flips its own copy of the state the instant the
   * heart is clicked, because the write is a NAS-backed SQLite round trip and a reader
   * here is arrowing through a folder quickly. It then discards that local copy on
   * resolve and hands the glyph back to the predicate. A caller that resolves *before*
   * re-reading its list would make the heart flick back for one render.
   *
   * Rejecting is how a failed write is reported: the viewer restores the previous glyph
   * rather than leaving the click's intention on screen.
   */
  onToggleFavorite?: (relativePath: string) => Promise<boolean>;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** The caller assembled the set. */
interface PhotoViewerSetProps extends PhotoViewerCommonProps {
  photos: ViewerPhoto[];
  folderPath?: never;
  onListFolder?: never;
  initialPhotoPath?: never;
  folderLabel?: string;
}

/** The viewer reads the folder itself. */
interface PhotoViewerFolderProps extends PhotoViewerCommonProps {
  photos?: never;
  /** The folder to browse, as a path from the photo root. */
  folderPath: string;
  /**
   * Reads the folder. Injected, so this component fetches nothing itself.
   *
   * PASS A STABLE REFERENCE — a module-scope server action, or one wrapped in
   * `useCallback`. The load effect depends on it, so an inline arrow defined in the
   * caller's render body is a new function every render and would re-read the folder in
   * a loop.
   */
  onListFolder: (folderPath: string) => Promise<ViewerFolderOutcome>;
  /**
   * Which photo opens first, as a path from the photo root.
   *
   * Matched against the listing rather than trusting an index, because the listing is
   * the only thing that knows the order — and a photo deleted since the caller drew it
   * falls back to the start of the folder rather than an empty stage.
   */
  initialPhotoPath?: string;
  /**
   * A friendlier name for the folder, shown above the file name.
   *
   * The archive's folder names carry a date and an event, so the caller usually has one.
   * Falls back to the last segment of `folderPath`.
   */
  folderLabel?: string;
}

export type PhotoViewerProps = PhotoViewerSetProps | PhotoViewerFolderProps;

/**
 * How many thumbnails are mounted at once.
 *
 * THE REASON THIS LIMIT EXISTS: there is no thumbnail pipeline. The archive's port is
 * read-only and forbids writing a cache into it, so a "thumbnail" here is the original
 * multi-megabyte JPEG scaled down by the browser. Mounting a 1,187-photo folder's worth
 * would queue 1,187 full-size reads over an SMB share and stall the strip for minutes.
 *
 * So the strip is a WINDOW around the current photo rather than the whole set. It still
 * scrolls the full width — every photo has a slot, keeping the scrollbar honest about
 * how big the set is — but only the slots near the reader hold an `<img>`.
 */
const THUMBNAIL_WINDOW = 24;

/** The two selects share this, so the panel's controls cannot drift apart. */
const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The header's pill controls share this, so the row reads as one family. */
const PILL_CLASS =
  "grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export function PhotoViewer({
  photos: suppliedPhotos,
  folderPath,
  onListFolder,
  initialPhotoPath,
  folderLabel,
  photoUrl,
  onClose,
  initialIndex,
  autoPlay = false,
  onPhotoDetails,
  isFavorite,
  onToggleFavorite,
  className = "",
}: PhotoViewerProps) {
  // The folder read's result. Unused when the caller supplied a set — `photos` below
  // picks whichever applies, so there is one list from here on and no branching in the
  // render.
  const [loadedPhotos, setLoadedPhotos] = useState<ViewerPhoto[]>([]);
  const [index, setIndex] = useState(() =>
    initialIndex !== undefined && initialIndex >= 0 ? initialIndex : 0,
  );
  const isFolderMode = folderPath !== undefined;
  // Only a folder read has a loading state. A caller-supplied set is already here, so
  // starting `true` would flash "Reading…" over photos that need no reading.
  const [isLoading, setIsLoading] = useState(isFolderMode);
  const [error, setError] = useState<string | undefined>(undefined);

  // Slideshow state. Options are NOT persisted — a freshly opened viewer always starts
  // from the defaults, so nobody wonders why tonight's slideshow inherited last month's
  // pace. `isPlaying` lives here rather than in the options because it is not a
  // preference, it is what the viewer is doing right now.
  const [options, setOptions] = useState<SlideshowOptions>(DEFAULT_SLIDESHOW_OPTIONS);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  // The capture details, keyed by path. A CACHE, not a single value: arrowing back to a
  // photo already inspected must not re-read its header over SMB, and the reader moves
  // back and forth constantly. `null` marks "asked, and there is nothing" so a second
  // look does not re-ask a file that has no EXIF.
  const [detailsByPath, setDetailsByPath] = useState<
    Record<string, ViewerPhotoDetails["details"] | null>
  >({});
  // Which path is being read right now, or `undefined`. A PATH rather than a boolean, so
  // the details line can tell "this photo is loading" from "some other photo is" — and
  // so a result arriving after the reader has moved on cannot leave a spinner behind.
  const [readingPath, setReadingPath] = useState<string | undefined>(undefined);
  // Which paths have already been ASKED about — the guard that stops a second read.
  //
  // A ref, and deliberately not derived from `detailsByPath`: the effect writes that
  // state, so depending on it would re-run the effect on every result and re-decide a
  // fetch already in flight. A ref is not a dependency, so the effect runs on a photo
  // change and nothing else.
  //
  // "Asked", not "answered", which is why this is written BEFORE the await rather than
  // alongside the result. A reader arrowing off a photo and straight back would
  // otherwise fire a second read for a request still in flight.
  const askedPathsRef = useRef<Set<string>>(new Set());

  // The heart's optimistic overrides, keyed by relative path.
  //
  // A MAP OF OVERRIDES rather than a copy of the favourites, because `isFavorite` stays
  // the source of truth: this holds only the paths this viewer has flipped and whose
  // effect has not yet come back through the caller's own state.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);

  // Only for prefetching the journal link — this component never navigates.
  const router = useRouter();

  // Reads the folder once per folder. Skipped entirely for a caller-supplied set.
  //
  // The effect owns an `isStale` flag rather than an AbortController: the action is a
  // server call whose result we simply stop applying, and a reader who reopens on a
  // different folder must not see the first one's photos arrive late and win.
  useEffect(() => {
    if (folderPath === undefined || onListFolder === undefined) return;

    let isStale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(undefined);

    void onListFolder(folderPath).then((outcome) => {
      if (isStale) return;
      setIsLoading(false);

      if (!outcome.ok || outcome.photos === undefined) {
        setError(outcome.error ?? "Couldn't read that folder.");
        setLoadedPhotos([]);
        return;
      }

      setLoadedPhotos(outcome.photos);
      // Land on the photo the reader clicked. `findIndex` rather than trusting a
      // caller-supplied number, because the folder listing is the only thing that knows
      // the order — and a photo deleted since the card drew it simply is not found,
      // which falls back to the start of the folder.
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

  // One list from here on, whichever way it arrived.
  //
  // `useMemo` rather than `??` inline: for the folder case this is `loadedPhotos`
  // either way, but a caller that inlines its `photos` array gets a new reference every
  // render, and several effects below depend on the list.
  const photos = useMemo(() => suppliedPhotos ?? loadedPhotos, [suppliedPhotos, loadedPhotos]);

  const photo = photos[index];
  const hasPrevious = index > 0;
  const hasNext = index < photos.length - 1;

  // Which day this photograph belongs to, for the "My Journal" link.
  //
  // EXIF FIRST when it has been read, because the camera's own record beats a name.
  // Falling back to `photoJournalDate`'s name-based guess keeps the link working before
  // the details arrive and for a photo whose metadata was stripped — the same
  // precedence `readPhotoDetails` follows, deliberately in step so the link and the
  // details line can never claim two different days for one picture.
  const label =
    folderLabel ?? (folderPath === undefined ? "" : (folderPath.split("/").pop() ?? folderPath));
  const details = photo === undefined ? undefined : detailsByPath[photo.relativePath];
  const journalDate =
    details?.takenAtDate ?? photoJournalDate({ photoName: photo?.name, folderName: label });
  // Built once because the link and the prefetch must ask for the SAME url — a prefetch
  // of a url that differs by a query param warms nothing the click can use.
  const journalHref =
    journalDate === undefined
      ? undefined
      : `/modules/journal/calendar?scope=month&anchor=${journalDate}&date=${journalDate}`;

  // Reads the details for the photo on the stage, once per photo.
  //
  // Guarded on `askedPathsRef`, so arrowing back and forth over the same few pictures
  // makes no further calls — and neither does arrowing away from a photo and back while
  // its read is still in flight.
  //
  // NO `isStale` FLAG, unlike the folder read above, and that is deliberate rather than
  // an omission: every result is written under its OWN path, so a late arrival updates
  // the cache entry it belongs to instead of overwriting the current photo's. Discarding
  // it would be strictly worse — the reader who arrows back would find nothing there and
  // pay for the read again.
  useEffect(() => {
    if (photo === undefined || onPhotoDetails === undefined) return;

    const path = photo.relativePath;
    if (askedPathsRef.current.has(path)) return;
    askedPathsRef.current.add(path);

    setReadingPath(path);

    void onPhotoDetails(path)
      .then((outcome) => {
        // `null` for a failure as well as for a genuine absence: both mean "there is no
        // timestamp to show", the reader can do nothing about either, and caching the
        // failure stops a broken share being re-asked on every arrow key.
        setDetailsByPath((current) => ({ ...current, [path]: outcome.details ?? null }));
      })
      .catch(() => {
        setDetailsByPath((current) => ({ ...current, [path]: null }));
      })
      .finally(() => {
        // Cleared only if this read is still the one on screen, so a result arriving
        // after the reader has moved on cannot wipe the newer photo's spinner.
        setReadingPath((current) => (current === path ? undefined : current));
      });
  }, [photo, onPhotoDetails]);

  // Whether the heart is offered at all, and whether it is filled.
  //
  // Both props required, not either: a predicate with no toggle is a control that
  // cannot act, and a toggle with no predicate is one that cannot say what it did.
  const canFavorite =
    isFavorite !== undefined && onToggleFavorite !== undefined && photo !== undefined;
  const isPhotoFavorite =
    photo !== undefined && isFavorite !== undefined
      ? (favoriteOverrides[photo.relativePath] ?? isFavorite(photo.relativePath))
      : false;

  /**
   * Keeps the photo on the stage, or stops keeping it.
   *
   * DOES NOT PAUSE THE SLIDESHOW, unlike the arrows. Starring during a run is the one
   * case where the reader is saying "this one" *about* what the timer is doing, and
   * stopping the show would make the gesture cost them the thing they were enjoying.
   */
  const toggleFavorite = useCallback(async () => {
    if (photo === undefined || onToggleFavorite === undefined) return;

    const path = photo.relativePath;
    setIsTogglingFavorite(true);
    setFavoriteOverrides((current) => ({ ...current, [path]: !isPhotoFavorite }));
    try {
      await onToggleFavorite(path);
      // DROPPED rather than set to the resolved state. By the time this resolves the
      // caller has updated its own list, so the predicate is authoritative again — and
      // an override left behind would keep asserting this answer forever, outliving a
      // change made on another screen.
      setFavoriteOverrides((current) => {
        if (current[path] === undefined) return current;
        const settled = { ...current };
        delete settled[path];
        return settled;
      });
    } catch {
      // Put it back. Silent on purpose: this header has nowhere to print a message, and
      // a heart that springs back is itself legible as "that didn't take".
      setFavoriteOverrides((current) => {
        const reverted = { ...current };
        delete reverted[path];
        return reverted;
      });
    } finally {
      setIsTogglingFavorite(false);
    }
  }, [photo, onToggleFavorite, isPhotoFavorite]);

  // Warms the journal route on hover/focus, a beat before the click.
  //
  // WHY THIS IS MANUAL rather than `<Link prefetch>`: Next prefetches a link when it
  // scrolls into the viewport, and this one never does that — it is inside a portal that
  // mounts already on screen, so the intersection observer has no crossing to see. The
  // result was a click that started the RSC fetch from cold and took seconds to paint.
  //
  // Hover rather than on mount, because the date changes with every photo: prefetching
  // eagerly would fire a fresh request for each picture someone arrows past. Next
  // dedupes and caches prefetches, so a wobbling cursor costs nothing.
  const prefetchJournal = useCallback(() => {
    if (journalHref !== undefined) router.prefetch(journalHref);
  }, [journalHref, router]);

  // Both manual steps stop the slideshow: taking hold of the arrows means looking at
  // this one properly, and a timer pulling the photo away two seconds later is the
  // opposite of what was asked.
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
      } else if (event.key === "f" || event.key === "F") {
        // `F` keeps the photo. Worth a binding because the whole point of the shortcut
        // is starring WITHOUT breaking the browse — reaching for the header button
        // means leaving the arrows, which is the flow this avoids.
        //
        // Modifier-free only: Ctrl/Cmd+F is the browser's find, and swallowing it here
        // would be taking a key that is not ours. Ignored when the caller passed no
        // favourite props, so the key is inert rather than silently doing nothing.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!canFavorite || isTogglingFavorite) return;
        void toggleFavorite();
      } else return;
      event.preventDefault();
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [
    onClose,
    goPrevious,
    goNext,
    index,
    photos.length,
    canFavorite,
    isTogglingFavorite,
    toggleFavorite,
  ]);

  // The page behind must not scroll while the viewer is up — on a phone a swipe would
  // otherwise move the page underneath instead of doing nothing.
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

    // The last photo ends the run rather than wrapping: leaving it going finishes on a
    // still picture instead of looping all evening.
    if (index >= photos.length - 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // inset-0 z-50` is only as good as its stacking context, and rendered inside a card
  // this would come out behind the app's own `z-40` header. The `document` guard covers
  // the server render, where there is no body to portal into.
  if (typeof document === "undefined") return null;

  // The caption the caller wants, falling back to the file name a folder browse has.
  const caption = photo?.caption ?? photo?.name ?? "";
  const subcaption = photo?.subcaption ?? (label === "" ? undefined : label);

  return createPortal(
    <div
      // `no-print`: a printed page is the page, not a screen overlay. Fully opaque
      // rather than a translucent scrim — this is a photo viewer, and the page showing
      // through behind a picture is a distraction rather than useful context.
      className={`no-print fixed inset-0 z-50 flex flex-col bg-black ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={label === "" ? "Photograph" : `Photos in ${label}`}
    >
      {/* The header carries its own opaque background: the app's `z-40` bar sits exactly
          here, and at anything less than opaque its nav links read straight through. */}
      <div className="flex items-start justify-between gap-3 bg-black px-4 py-3 text-white">
        <div className="min-w-0">
          {subcaption !== undefined && (
            <p className="truncate text-sm text-white/60">{subcaption}</p>
          )}
          <p className="truncate font-mono text-sm">{caption}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Keeps the photo on the stage. First of the header controls because it is
              the only one that CHANGES something — the others navigate, count or close.

              Not the app's `Button`: this header is opaque black, where `Button`'s
              `secondary` variant is paper-on-paper with a `--line` shadow and reads as a
              pale slab rather than a control. The `bg-white/10` pill is what keeps the
              header's controls one family.

              Stays visible at every width, unlike the `n / total` counter: a control the
              reader acts with outranks a figure the thumbnail strip already tells them. */}
          {canFavorite && (
            <button
              type="button"
              onClick={() => void toggleFavorite()}
              disabled={isTogglingFavorite}
              // `aria-pressed` rather than a changing label alone: this is one toggle in
              // two states, not two different buttons, and a screen reader should hear
              // the state on the same control.
              aria-pressed={isPhotoFavorite}
              aria-label={isPhotoFavorite ? "Remove from favorites" : "Mark as favorite"}
              title={isPhotoFavorite ? "Remove from favorites (F)" : "Mark as favorite (F)"}
              className={`${PILL_CLASS} disabled:opacity-60`}
            >
              {/* Outline vs solid is what carries the state, which is why both glyphs
                  stay hand-drawn — see ALWAYS_CLASSIC in tree-icons.tsx. No `SlotIcon`:
                  this is a state glyph on a toggle, not a mark for a PLACE.

                  `text-brass` and not the home card's `text-brass-dark`, which against
                  black is too near the background to read. */}
              <TreeIcon
                name={isPhotoFavorite ? "heart-filled" : "heart"}
                className={`h-5 w-5 ${isPhotoFavorite ? "text-brass" : ""}`}
              />
            </button>
          )}

          {/* Opens the journal's calendar on the day this photograph was taken, with
              that day selected — so a picture found by browsing leads to what was
              written about it.

              A plain `<Link>` rather than the app's `Button`, for the reason the heart
              above documents. Same tab on purpose: the destination is somewhere to READ,
              not a glance, and Ctrl/middle-click still gives a second tab. The cost is
              real and known — the viewer holds no URL state, so Back returns to the page
              behind it rather than to this photo.

              Only offered when a date could be established. A link that opened the
              journal on a guessed day would be worse than none. */}
          {journalHref !== undefined && (
            <Link
              href={journalHref}
              // `onMouseEnter` for a cursor, `onFocus` for a keyboard — tabbing to the
              // link is the same declaration of intent as hovering it. `onTouchStart`
              // covers the phone, where there is no hover at all: it fires on
              // finger-down, which buys the tens of milliseconds before the tap
              // completes.
              onMouseEnter={prefetchJournal}
              onFocus={prefetchJournal}
              onTouchStart={prefetchJournal}
              title={`Open the journal for ${journalDate}`}
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              My Journal
            </Link>
          )}

          {photos.length > 0 && (
            // Hidden on a phone: with the journal link beside it, the counter is the
            // thing that can go — which photo of how many is a nicety, and the
            // thumbnail strip below says the same thing.
            <span className="text-xs text-white/60 max-lg:hidden">
              {index + 1} / {photos.length}
            </span>
          )}
          {/* Large tap target: this is the primary way out on a phone, where there is no
              Escape key and the stage covers the screen. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${PILL_CLASS} text-xl leading-none`}
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
          <p className="text-sm text-white/60">There are no photographs to show.</p>
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
              alt={caption}
              className={`max-h-full max-w-full object-contain ${effectClass(options.effect)}`}
            />

            {hasPrevious && <NavButton side="left" label="Previous photo" onClick={goPrevious} />}
            {hasNext && <NavButton side="right" label="Next photo" onClick={goNext} />}
          </>
        )}
      </div>

      {/* The lower half: details, thumbnails, then the slideshow panel. All `shrink-0` so
          the stage above is the part that gives way on a short screen. */}
      <div className="shrink-0 bg-black px-4 pb-4 pt-3">
        {photo !== undefined && onPhotoDetails !== undefined && (
          <PhotoDetailsLine
            relativePath={photo.relativePath}
            details={detailsByPath[photo.relativePath]}
            // Compared by PATH, so the spinner belongs to this photo. A bare boolean
            // would show "Reading…" over a cached photo whenever a neighbour's read
            // happened to be in flight.
            isReading={readingPath === photo.relativePath}
          />
        )}

        {photos.length > 1 && (
          <div
            ref={stripRef}
            // A single scrolling row, not a wrapping grid: the strip's job is "where am I
            // in this set", which a line preserves and a block of rows loses.
            className="mb-3 flex gap-2 overflow-x-auto pb-2"
          >
            {photos.map((candidate, candidateIndex) => {
              const isActive = candidateIndex === index;
              // Every photo gets a slot so the scrollbar reflects the real set size, but
              // only those near the reader hold an image. See THUMBNAIL_WINDOW.
              const isInWindow = Math.abs(candidateIndex - index) <= THUMBNAIL_WINDOW / 2;
              const thumbLabel = candidate.caption ?? candidate.name;

              return (
                <button
                  key={candidate.relativePath}
                  type="button"
                  data-active={isActive}
                  onClick={() => goTo(candidateIndex)}
                  title={thumbLabel}
                  aria-label={thumbLabel}
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

        {photos.length > 1 && (
          // Collapsed by default: the pictures are the point, and a settings panel
          // sitting open under every photo would be the loudest thing on a phone.
          //
          // Only for a real set. A single photo has nothing to play, and offering a
          // slide show with a permanently disabled button would be a control that
          // exists to say no.
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
                  // from the top instead — the reader plainly meant "play the set".
                  if (!isPlaying && index >= photos.length - 1) setIndex(0);
                  setIsPlaying(!isPlaying);
                }}
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
 * The path and capture timestamp of the photo on the stage.
 *
 * Its own component so the fetch state has one place to be rendered, and so the three
 * cases a reader can actually distinguish are visible together: still reading, a
 * timestamp with a source, and nothing available.
 *
 * THE SOURCE IS SHOWN, not just the date. "The camera recorded 14:35:01" and "the file
 * is called IMG_20190609" are different claims, and presenting an inferred date in the
 * same words as an EXIF one would dress a guess up as a fact.
 */
function PhotoDetailsLine({
  relativePath,
  details,
  isReading,
}: {
  relativePath: string;
  details: ViewerPhotoDetails["details"] | null | undefined;
  isReading: boolean;
}) {
  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-white/40">Path</dt>
      {/* `break-all`, not `truncate`: a path is the one thing here worth reading in
          full, and an archive path is long enough that the interesting end is what a
          truncation would cut. The RELATIVE path, not an absolute one — the archive root
          is server-side configuration, and putting the NAS host in the DOM would leak
          infrastructure for no reader benefit. */}
      <dd className="break-all font-mono text-white/70">{relativePath}</dd>

      <dt className="text-white/40">Taken</dt>
      <dd className="font-mono text-white/70">
        {isReading ? (
          <span className="text-white/40">Reading…</span>
        ) : details?.takenAtDate === undefined ? (
          // The honest answer, and the one asked for. There is nothing to retry: the
          // file carries no timestamp and its name establishes no date.
          <span className="text-white/40">Not available</span>
        ) : (
          <>
            {details.takenAtDate}
            {details.takenAtTime !== undefined && ` ${details.takenAtTime}`}
            {/* No timezone is printed because none was recorded. EXIF is local
                wall-clock time at the shutter, so there is nothing to convert and
                nothing to label. */}
            <span className="ml-2 text-white/40">{sourceLabel(details.takenAtSource)}</span>
          </>
        )}
      </dd>
    </dl>
  );
}

/**
 * How a date was established, in words a reader can weigh.
 *
 * Spelled out rather than shown as a badge or an icon: the distinction only matters when
 * someone is actually reading the date, and at that moment three words are clearer than
 * a glyph they would have to learn.
 */
function sourceLabel(source: NonNullable<ViewerPhotoDetails["details"]>["takenAtSource"]): string {
  switch (source) {
    case "exif":
      return "from the camera";
    case "file-name":
      return "from the file name";
    case "folder":
      return "from the folder name";
    default:
      return "";
  }
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
