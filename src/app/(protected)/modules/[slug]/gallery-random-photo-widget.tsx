"use client";

// One-off widget for the Picture Gallery's home screen (not a registered shared
// component), mirroring daily-quote-widget.tsx: the server draws the first photograph,
// and the refresh button draws another without reloading the page, so only the picture
// changes.
//
// Lived at (protected)/random-photo-widget.tsx while this was an app home-screen card.
// The name `RandomPhotoWidget` is unchanged -- it names the card, which is still what
// this is.

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PhotoViewer } from "@/components/photo-viewer";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import type { FavPhoto } from "@/lib/fav-photos";
import { getIconSlot } from "@/lib/icons";
// From the leaf file, not the `@/lib/journal-photos` barrel: that barrel also
// re-exports `NodePhotoFileStore`, which imports `node:fs/promises` and
// `node:path`, and a client component pulling it in fails the webpack build.
import type { RandomPhotoPick } from "@/lib/journal-photos/random";
import { calendarAgeSince, formatCalendarAge } from "@/lib/shared/date";
import {
  listAllPhotosInFolderAction,
  readPhotoDetailsAction,
} from "../../photos-viewer-actions";
import {
  cullGalleryPhotosAction,
  inspectGalleryPhotoAction,
  type InspectedGalleryPhoto,
} from "./gallery-culling-actions";
import {
  drawRandomPhotoAction,
  listFavPhotosAction,
  toggleFavPhotoAction,
} from "./gallery-photo-actions";
import { useAlbumFiling } from "./use-album-filing";

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

// Resolved once at module scope: `getIconSlot` reads the static registry, so this is not
// I/O. The guard is for the registry rather than the user -- if the id is ever removed
// the card loses its glyph instead of crashing.
const RANDOM_PHOTO_SLOT = getIconSlot("homescreen_card_random_photo");

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

/**
 * The folder a photo sits in — everything before the last slash.
 *
 * Derived here rather than added to `RandomPhotoPick`, because the pick already carries
 * the full path and the answer is a string operation on it. `""` for a path with no
 * slash, which the button treats as "nothing to open" rather than as the archive root.
 */
function folderPathOf(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash <= 0 ? "" : relativePath.slice(0, lastSlash);
}

/**
 * What to tell the reader when no photograph came back.
 *
 * Each reason has a different fix, which is the entire reason the use-case carries one
 * instead of a boolean -- "set the path" and "the NAS is not answering" should not read
 * the same. Kept as one function so the card has a single empty state.
 */
function messageFor(pick: RandomPhotoPick): string {
  switch (pick.reason) {
    case "not-configured":
      return "No photo folder is configured yet — set one in the Journal module's configuration.";
    case "missing":
      return "The configured photo folder can't be found. Check the path in the Journal module's configuration.";
    case "no-permission":
      return "The photo folder exists but can't be read. Check the share's permissions.";
    case "not-a-directory":
      return "The configured photo path is a file, not a folder.";
    case "unreachable":
      return "The photo folder can't be reached right now.";
    case "no-photos":
      return "Couldn't find a photo to show. Try again.";
    default:
      return "No photo to show.";
  }
}

/**
 * A measurement, rounded for reading rather than for arithmetic.
 *
 * One decimal place: the Laplacian variance of a real photograph runs to hundreds, and
 * the digits past the point are decode noise that would only invite a reader to compare
 * two numbers that are not meaningfully different.
 */
function round(value: number): string {
  return value.toFixed(1);
}

/** A 0-1 clipping fraction as a percentage, which is how a reader thinks about it. */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * The rows of the measurement panel.
 *
 * Built here rather than inline in the JSX so the panel is a `map` over facts instead
 * of a wall of markup, and so the ORDER is stated once: the two sharpness figures, then
 * the three exposure ones, then the frame's size.
 *
 * ## The explanations
 *
 * `note` says what the number MEANS and which way is better, because the raw figures
 * are meaningless to anyone who has not read `lib/culling/metrics.ts` -- a Laplacian
 * variance of 412 tells an unprepared reader nothing at all. Each note is written from
 * that file's documented behaviour rather than from a general idea of what the word
 * usually means, so the panel cannot drift away from what was actually computed.
 *
 * Every note says "higher is X" or "nearer X is better" and stops there. None of them
 * says whether THIS value is good, and that restraint is the point: there is no
 * absolute cutoff for sharpness or contrast anywhere in this codebase because none
 * exists -- 412 is tack-sharp from a phone at night and soft from a DSLR in daylight.
 * Inventing a threshold so a note could say "sharp" would be exactly the dishonesty the
 * rank-based scorer was built to avoid.
 *
 * `hint` is the one exception, and only for clipping: `config.exposure.clipTolerance`
 * is a real absolute threshold, so "overexposed" is a judgement these numbers genuinely
 * support on their own.
 */
function measurementRows(
  photo: InspectedGalleryPhoto,
): { label: string; value: string; note: string; hint?: string }[] {
  const { metrics } = photo;
  const tolerance = percent(photo.clipTolerance);

  return [
    {
      label: "Sharpness",
      value: round(metrics.sharpness),
      // Variance of the Laplacian over the whole frame -- see `laplacianVariance`.
      note: "Edge detail across the whole frame. Higher is sharper; near zero means out of focus. The scale depends on the camera and the scene, so it only compares against similar photos.",
    },
    {
      label: "Centre sharpness",
      value: round(metrics.centerSharpness),
      // The same measure over the centre 50% by linear dimension -- a quarter of the
      // area. Worth explaining rather than leaving as a near-duplicate number: the gap
      // between the two figures is the informative part.
      note: "The same measure over the middle quarter of the frame, where the subject usually is. Much higher than the figure above means a sharp subject against a deliberately blurred background, not a soft photo.",
    },
    {
      label: "Brightness",
      value: `${round(metrics.brightness)} / 255`,
      // Mean luminance. 128 is mid-grey, which is what the scorer ranks distance from.
      note: "Average luminance of every pixel. 128 is mid-grey; the culler treats nearer the middle as better exposed, so very low is dark and very high is washed out.",
    },
    {
      label: "Contrast",
      value: round(metrics.contrast),
      // Standard deviation of luminance.
      note: "How widely the tones spread out. Higher means punchier; a low figure means a flat or hazy frame, whatever its average brightness.",
    },
    {
      label: "Shadow clipping",
      value: percent(metrics.shadowClipping),
      // `clippedFraction(pixels, shadowLevel = 5, "below")`.
      note: `Pixels crushed to near-black, with no detail left to recover. Over ${tolerance} counts as underexposed.`,
      hint:
        photo.exposure === "underexposed" ? `underexposed — over ${tolerance}` : undefined,
    },
    {
      label: "Highlight clipping",
      value: percent(metrics.highlightClipping),
      // `clippedFraction(pixels, highlightLevel = 250, "above")`.
      note: `Pixels blown to near-white, with no detail left to recover. Over ${tolerance} counts as overexposed — a blown sky cannot be brought back.`,
      hint: photo.exposure === "overexposed" ? `overexposed — over ${tolerance}` : undefined,
    },
    {
      label: "Dimensions",
      value: `${photo.width} × ${photo.height}`,
      // From `analyzeImage`, which rotates before measuring.
      note: "Pixel size of the original after any EXIF rotation, so a portrait shot reads as taller than it is wide.",
    },
  ];
}

/**
 * The card's title, with how long ago the photograph was taken when that is known.
 *
 * Computed on the client, per render, deliberately: the age is relative to *now*, and
 * baking it into the server payload would leave a tab open overnight claiming a photo
 * is a day younger than it is. The pick carries the capture DATE; the arithmetic
 * against today belongs wherever it is being read.
 *
 * A photo with no readable date, or no photo at all, gets the bare title rather than a
 * placeholder — there is nothing honest to put in its place. The same for a date that
 * will not parse: `calendarAgeSince` throws on one, and both producers of `takenAt`
 * validate, but the value arrives over a server-action boundary and a home screen that
 * goes blank over a card title is not a trade worth making.
 */
function titleFor(pick: RandomPhotoPick, now: Date): string {
  if (pick.takenAt === undefined) return "Random photo";
  try {
    return `Random photo · ${formatCalendarAge(calendarAgeSince(pick.takenAt, now))}`;
  } catch {
    return "Random photo";
  }
}

export function RandomPhotoWidget({
  initialPick,
  initialFavorites,
  className,
}: {
  /** The photograph drawn on the server for this page load. */
  initialPick: RandomPhotoPick;
  /**
   * Every favourite, read on the server for this page load.
   *
   * The whole list rather than a bare `isFavorite` for the drawn photo, because the
   * card needs two answers from it: which glyph the heart shows, and how many
   * favourites there are to badge the link to the Favorite photos section with.
   * One read serves both.
   */
  initialFavorites: FavPhoto[];
  /** Spacing is the caller's call, as with the other cards in this module. */
  className?: string;
}) {
  const [pick, setPick] = useState(initialPick);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * Whether the drawn photograph's bytes are still on their way.
   *
   * Separate from `isDrawing`, which only covers the server's walk. The walk is the
   * fast half -- tens of milliseconds -- and the image is the slow one, several
   * hundred for a megabyte of JPEG. Clearing the spinner when the walk returned left
   * the card claiming to be done while it still showed the PREVIOUS photograph, with
   * the new file name already in the caption beneath it. The button is busy until the
   * picture the reader asked for is actually on screen.
   */
  const [isImageLoading, setIsImageLoading] = useState(false);

  // The viewer, opened by clicking the picture or the header's folder button.
  //
  // ONE flag, where there used to be two. The card previously wired the picture to a
  // lightbox and the folder glyph to a folder browser -- an invisible distinction that
  // sent the obvious gesture to the lesser overlay, with no heart and no way to reach
  // the pictures beside it. Both now open the same viewer on the same folder.
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [isFavoriting, setIsFavoriting] = useState(false);

  // The cull button's result, shown under the caption. THREE pieces rather than one
  // nullable result, because "measuring", "measured" and "could not measure" are three
  // different things the panel says, and collapsing them would make an in-flight run
  // indistinguishable from a finished one with no numbers.
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspected, setInspected] = useState<InspectedGalleryPhoto | undefined>(undefined);
  const [inspectError, setInspectError] = useState<string | undefined>(undefined);

  // The viewer's "add to album" plumbing. A hook rather than four more pieces of state
  // here, because the favourites screen and the albums screen need exactly the same
  // four props -- see use-album-filing.ts.
  const albumFiling = useAlbumFiling();

  /**
   * Measures the photograph on screen and shows what came back.
   *
   * NOT a cull of one. The culler ranks a set, and a set of one ranks at the neutral
   * midpoint by construction, so this reports the picture's own absolute measurements
   * and the panel says plainly that there is no score — see `lib/culling/inspect.ts`.
   */
  async function handleInspect() {
    if (pick.relativePath === undefined) return;
    setIsInspecting(true);
    // Both cleared up front: a second run must not leave the previous photo's numbers
    // on screen while the new ones are still being read.
    setInspected(undefined);
    setInspectError(undefined);
    try {
      const result = await inspectGalleryPhotoAction(pick.relativePath);
      if (result.ok && result.photo !== undefined) setInspected(result.photo);
      else setInspectError(result.error ?? "Couldn't measure this photo.");
    } catch {
      // The action turns an unreadable file into `{ ok: false }`; this only catches the
      // request itself failing, which would otherwise leave the button spinning.
      setInspectError("Couldn't measure this photo.");
    } finally {
      setIsInspecting(false);
    }
  }

  async function handleRefresh() {
    setIsDrawing(true);
    setError(undefined);
    // The panel describes the photograph being replaced, so it goes with it. Leaving it
    // up would caption a new picture with the old one's measurements.
    setInspected(undefined);
    setInspectError(undefined);
    try {
      const drawn = await drawRandomPhotoAction();
      // Armed BEFORE the pick is stored, so there is no render in between where the
      // new caption is showing and nothing is marked as loading.
      setIsImageLoading(drawn.relativePath !== undefined);
      setPick(drawn);
    } catch {
      // The action already turns a failed walk into a `reason`; this only catches the
      // request itself failing, which would otherwise leave the button spinning.
      setError("Couldn't draw another photo.");
      setIsImageLoading(false);
    } finally {
      setIsDrawing(false);
    }
  }

  /**
   * Keeps the photo on screen, or stops keeping it.
   *
   * Re-reads the list afterwards rather than patching it locally: the row the server
   * created carries a `createdAt` this side cannot invent, and the dialog is opened
   * from the same state.
   */
  async function handleToggleFavorite() {
    if (pick.relativePath === undefined) return;
    setIsFavoriting(true);
    setError(undefined);
    try {
      await toggleFavPhotoAction(pick.relativePath);
      setFavorites(await listFavPhotosAction());
    } catch {
      setError("Couldn't change that favourite.");
    } finally {
      setIsFavoriting(false);
    }
  }

  /**
   * The viewer's favourite predicate — is THIS path kept?
   *
   * Separate from `isFavorited` below, which answers the same question about the one
   * photo the card is showing. The viewer browses the whole folder, so it needs to ask
   * per photo, and reads the answer out of the list this card already holds rather than
   * fetching its own.
   *
   * `useCallback` because `PhotoViewer` re-derives on every photo change and a fresh
   * function each render would be pointless churn; keyed on `favorites` so starring
   * from inside the viewer refills the heart once the list comes back.
   */
  const isPhotoFavorited = useCallback(
    (relativePath: string) =>
      favorites.some((favorite) => favorite.relativePath === relativePath),
    [favorites],
  );

  /**
   * The viewer's toggle. Takes the path and reports the state it landed in.
   *
   * Not `handleToggleFavorite`: that one is bound to the drawn photo the card is
   * showing, whereas the viewer stars whatever is on its own stage.
   *
   * The re-read IS awaited, and that is the viewer's contract rather than an
   * oversight — `onToggleFavorite` must not resolve until `isFavorite` would give the
   * new answer, because the viewer drops its optimistic override on resolve and hands
   * the glyph back to the predicate. Returning early would show the old glyph for a
   * render. Awaiting it also leaves the card's own heart and the favourites badge in
   * step with whatever was starred while browsing.
   */
  const toggleFavoriteByPath = useCallback(async (relativePath: string) => {
    const landed = await toggleFavPhotoAction(relativePath);
    setFavorites(await listFavPhotosAction());
    return landed;
  }, []);

  // The single-photo set for the viewer's SET form, memoised on the three values that
  // identify the picture rather than rebuilt inline in the JSX.
  //
  // WHY THIS IS NOT COSMETIC: this card re-renders every time its <img> fires `onLoad`
  // (see `setIsImageLoading` below), and an inline `photos={[...]}` would hand
  // `PhotoViewer` a new array -- and so a new `photo` object -- on each of those
  // renders. Anything inside the viewer keyed on the photo object rather than on its
  // path gets reset by that, which is a whole class of "the overlay forgot what I was
  // doing" bugs for something the reader never touched.
  const viewerPhotos = useMemo(
    () =>
      pick.relativePath === undefined
        ? []
        : [
            {
              name: pick.name ?? "",
              relativePath: pick.relativePath,
              subcaption: pick.folderName,
            },
          ],
    [pick.relativePath, pick.name, pick.folderName],
  );

  const hasPhoto = pick.relativePath !== undefined;
  // The folder the drawn photo came from, or `""` when there is nothing to browse.
  // Derived rather than held: it is a function of the pick, and holding it would be a
  // second thing to keep in step with the refresh button.
  const folderPath = pick.relativePath === undefined ? "" : folderPathOf(pick.relativePath);
  // Derived from the list rather than held as its own flag, so removing the shown photo
  // from inside the dialog un-fills the heart without a second round trip.
  const isFavorited =
    pick.relativePath !== undefined &&
    favorites.some((favorite) => favorite.relativePath === pick.relativePath);
  // `new Date()` in the render body, not in state: a fresh draw re-renders anyway, and
  // the value only ever needs to be right at the moment the title is drawn. Day-level
  // arithmetic, so there is nothing here for a ticking clock to keep up with.
  const title = titleFor(pick, new Date());
  const caption = pick.folderName !== undefined ? `${pick.folderName} / ${pick.name}` : pick.name;

  return (
    // Open by default, unlike the Daily Quote: the picture IS the card, and one that
    // opens shut would only ever show its own title. The refresh button lives in
    // `headerAction` so it stays reachable and doesn't toggle the card.
    <CollapsibleCard
      title={title}
      titleIcon={
        RANDOM_PHOTO_SLOT ? <SlotIcon slot={RANDOM_PHOTO_SLOT} className="h-4 w-4" /> : undefined
      }
      className={className}
      defaultOpen
      headerAction={
        // Four icon-only controls in one row: keep this photo, open the folder it came
        // from, draw another, read the kept ones back. All in `headerAction` so none of
        // them toggles the card.
        <div className="flex items-center gap-1">
          {/* Only offered when there is a photograph to keep — a heart on an empty card
              would have nothing to act on. */}
          {hasPhoto && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleToggleFavorite}
              disabled={isFavoriting}
              title={isFavorited ? "Remove from favorites" : "Mark as favorite"}
              ariaLabel={isFavorited ? "Remove from favorites" : "Mark as favorite"}
            >
              {/* Outline vs solid is what carries the state, which is why both glyphs
                  stay hand-drawn — see ALWAYS_CLASSIC in tree-icons.tsx. */}
              <TreeIcon
                name={isFavorited ? "heart-filled" : "heart"}
                className={`h-4 w-4 ${isFavorited ? "text-brass-dark" : ""}`}
              />
            </Button>
          )}

          {/* Measures this one photograph. A ROW ACTION, not a place, so it is a bare
              `TreeIcon` rather than an icon slot — the same reasoning as the heart above
              and the two glyphs below, and the rule in coding-guide.md → "Icons: use a
              slot, not a bare glyph name". `flash` is in ALWAYS_CLASSIC, so a themed set
              cannot swap it for artwork that reads as decoration.

              Offered only when there is a photograph to measure. */}
          {hasPhoto && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleInspect}
              disabled={isInspecting || isDrawing || isImageLoading}
              title="Cull this photo — measure it on its own"
              ariaLabel="Cull this photo — measure it on its own"
            >
              <TreeIcon
                name="flash"
                className={`h-4 w-4 ${isInspecting ? "animate-pulse" : ""}`}
              />
            </Button>
          )}

          {/* Opens the same viewer the picture itself opens, on the folder this
              photograph came from. KEPT ALONGSIDE the picture click rather than removed:
              the glyph names what the gesture does, which a bare photo does not, and it
              is the only affordance a keyboard reader can tab to.

              Only offered when there is a folder to open — a photo loose at the archive
              root has no siblings to show, and a button that opens an empty viewer is
              worse than no button. */}
          {hasPhoto && folderPath !== "" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsViewerOpen(true)}
              title={`Open ${pick.folderName ?? "this photo's folder"}`}
              ariaLabel={`Open ${pick.folderName ?? "this photo's folder"}`}
            >
              {/* `photo-folder`, not a plain folder: it sits beside a heart and a photo
                  stack, and has to read as "the folder of pictures" in a row that is
                  entirely about pictures. In ALWAYS_CLASSIC for that reason, so no icon
                  slot — a slot offering to override it would be a control that does
                  nothing. */}
              <TreeIcon name="photo-folder" className="h-4 w-4" />
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            // Disabled for the whole draw, image included. Clicking again while a
            // photograph was still arriving started a second draw whose bytes could
            // land in either order, so a fast third click could leave the card on
            // the second photo's picture under the third one's caption.
            disabled={isDrawing || isImageLoading}
            title="Show a different photo"
            ariaLabel="Show a different photo"
          >
            <RefreshIcon
              className={`h-4 w-4 ${isDrawing || isImageLoading ? "animate-spin" : ""}`}
            />
          </Button>

          {/* Navigates rather than opening a dialog. The list carries bulk selection,
              a zip download and multi-row deletion now — work that wants a URL and a
              back button, not an overlay that a stray Escape can dismiss halfway
              through. `href` makes this a real link, so it also middle-clicks. */}
          <Button
            size="sm"
            variant="secondary"
            href="/modules/picture-gallery/favorites"
            title="My favorite photos"
            ariaLabel="My favorite photos"
          >
            {/* `photo-stack`, not `heart-filled`. This button is a destination; the
                heart two controls to the left is a toggle whose fill says whether the
                shown photo is kept. Sharing one glyph made the header read as two
                hearts doing different jobs. No icon slot: `photo-stack` is in
                `ALWAYS_CLASSIC` for the reason above, so a slot offering to override it
                would be a control that does nothing. */}
            <TreeIcon name="photo-stack" className="h-4 w-4" />
            {/* The count is the one piece of text in this row: it tells the reader
                whether the list is worth opening before they open it. Hidden on a
                phone, where three glyphs and a number crowd the title. */}
            {favorites.length > 0 && (
              // Hidden below `xl`, not `lg`: with the folder button added there are four
              // glyphs in this row, and a number after them wrapped the title on a
              // tablet. The count is a nicety — which list to open is still obvious
              // without it — so it is the thing that goes when space is short.
              <span className="ml-1 text-xs max-xl:hidden">{favorites.length}</span>
            )}
          </Button>
        </div>
      }
    >
      {hasPhoto && pick.relativePath !== undefined ? (
        <figure>
          {/* A plain <img>, not next/image: these bytes come from a session-guarded
              route over an SMB share, so the optimiser has nothing to cache and would
              only add a round trip. `max-h` in viewport units rather than a fixed
              height is what keeps a portrait shot from filling a phone screen and a
              landscape one from dominating a desktop -- one rule, both boundaries. */}
          {/* `relative` so the loading overlay below can sit over the picture.
              `min-h` holds the card open while a fresh <img> is still transparent
              -- without it the figure collapses to the caption and the whole page
              jumps on every draw. */}
          <button
            type="button"
            onClick={() => setIsViewerOpen(true)}
            className={`relative block w-full cursor-zoom-in ${
              isImageLoading ? "min-h-[40vh]" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the bytes come from
                our own session-guarded route over an SMB share, not a static asset
                next/image can optimize. */}
            <img
              // Keyed on the path so a draw MOUNTS a new element instead of
              // mutating this one's `src`. Mutating it keeps the decoded previous
              // photograph on screen until the new bytes arrive; a fresh element
              // has nothing to show, so the dimmed placeholder below is what the
              // reader sees during the load rather than the wrong picture.
              key={pick.relativePath}
              src={photoUrl(pick.relativePath)}
              alt={caption ?? "A photograph from the archive"}
              className={`mx-auto max-h-[60vh] w-auto rounded-lg object-contain transition-opacity duration-200 ${
                isImageLoading ? "opacity-0" : "opacity-100"
              }`}
              // The load is the slow half of a draw, so the card's busy state ends
              // here rather than when the server's walk returned. `onError` too --
              // a photo whose bytes fail must not leave the button spinning
              // forever.
              onLoad={() => setIsImageLoading(false)}
              onError={() => setIsImageLoading(false)}
            />

            {/* Only while the bytes are in flight. Absolute so it does not add to
                the figure's height -- the `min-h` above is what reserves the room. */}
            {isImageLoading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <RefreshIcon className="h-6 w-6 animate-spin text-muted" />
              </span>
            )}
          </button>

          <figcaption className="mt-3 text-center text-sm text-muted break-words">
            {caption}
          </figcaption>

          {/* The cull result, inline under the caption so the picture stays beside its
              numbers. Two columns on a wide screen, one below 1024px — `max-lg:` only,
              so the desktop grid is provably untouched. */}
          {isInspecting && (
            <p className="mt-3 text-sm text-muted" aria-live="polite">
              Measuring this photograph…
            </p>
          )}

          {inspectError && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {inspectError}
            </p>
          )}

          {inspected && (
            <div className="mt-3 rounded-lg border border-line bg-paper p-3">
              <p className="text-sm font-semibold text-ink">Cull result · {inspected.name}</p>

              {/* Two columns of rows on a wide screen, one below 1024px — `max-lg:`
                  only, so the desktop grid is provably untouched. Each row stacks its
                  own label/value line above the explanation, because the notes are
                  sentences: a label/value grid with prose in a third column would leave
                  one tall ragged column beside six short ones. */}
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 max-lg:grid-cols-1">
                {measurementRows(inspected).map((row) => (
                  <div key={row.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm text-muted">{row.label}</dt>
                      <dd className="text-sm tabular-nums text-ink">
                        {row.value}
                        {/* The one absolute judgement these numbers support. */}
                        {row.hint && (
                          <span className="ml-2 text-xs text-red-400">{row.hint}</span>
                        )}
                      </dd>
                    </div>
                    {/* What the number means and which way is better — never whether
                        this particular value is good. See `measurementRows`. */}
                    <p className="mt-0.5 text-xs leading-snug text-muted">{row.note}</p>
                  </div>
                ))}
              </dl>

              {/* Said plainly rather than left for the reader to infer. Culling ranks a
                  set against itself; one photograph has no set, so there is deliberately
                  no score and no keeper verdict here — and without this line the bare
                  numbers would invite a comparison they cannot support. */}
              <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
                These are this photograph&rsquo;s own measurements. There is no score or
                keeper verdict: culling ranks photographs against each other, and a single
                photograph has nothing to be ranked against. To rank this one, cull its
                folder from the photo viewer.
              </p>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </figure>
      ) : (
        <div>
          <p className="text-sm text-muted">{messageFor(pick)}</p>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}

      {/* The viewer, for both the picture click and the folder glyph.

          Mounted only while open, because in folder mode it reads the folder on mount —
          keeping it mounted would list the folder on every draw, whether or not anyone
          asked to see it. It owns no open state of its own, like every other overlay in
          the app.

          TWO SHAPES, one component. Normally the folder form, so the reader lands on the
          drawn photo with the rest of the event beside it. A photo loose at the archive
          root has no folder to list, so it gets the single-photo set form instead —
          without that branch the obvious gesture would do nothing for those photos,
          which is the bug this whole change set out to fix. */}
      {isViewerOpen && pick.relativePath !== undefined && (
        folderPath !== "" ? (
          <PhotoViewer
            folderPath={folderPath}
            initialPhotoPath={pick.relativePath}
            folderLabel={pick.folderName}
            onListFolder={listAllPhotosInFolderAction}
            // Folder mode only: the single-photo form below has one picture, and
            // culling a set of one would answer nothing.
            onCull={cullGalleryPhotosAction}
            photoUrl={photoUrl}
            onPhotoDetails={readPhotoDetailsAction}
            isFavorite={isPhotoFavorited}
            onToggleFavorite={toggleFavoriteByPath}
            {...albumFiling}
            onClose={() => setIsViewerOpen(false)}
          />
        ) : (
          <PhotoViewer
            photos={viewerPhotos}
            photoUrl={photoUrl}
            onPhotoDetails={readPhotoDetailsAction}
            isFavorite={isPhotoFavorited}
            onToggleFavorite={toggleFavoriteByPath}
            {...albumFiling}
            onClose={() => setIsViewerOpen(false)}
          />
        )
      )}

    </CollapsibleCard>
  );
}
