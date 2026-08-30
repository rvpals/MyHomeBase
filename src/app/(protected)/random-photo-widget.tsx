"use client";

// One-off home-screen widget (not a registered shared component), mirroring
// daily-quote-widget.tsx: the server draws the first photograph, and the refresh button
// draws another without reloading the page, so only the picture changes.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import type { FavPhoto } from "@/lib/fav-photos";
import { getIconSlot } from "@/lib/icons";
import type { RandomPhotoPick } from "@/lib/journal-photos";
import { calendarAgeSince, formatCalendarAge } from "@/lib/shared/date";
import { FavPhotosDialog } from "./fav-photos-dialog";
import {
  drawRandomPhotoAction,
  listFavPhotosAction,
  toggleFavPhotoAction,
} from "./random-photo-actions";

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
   * card needs both answers: which glyph the heart shows, and what the dialog opens
   * onto. One read serves both, and it means pressing "My favorites" shows the list
   * immediately instead of opening onto a spinner.
   */
  initialFavorites: FavPhoto[];
  /** Spacing is the caller's call, as with the other home-screen cards. */
  className?: string;
}) {
  const [pick, setPick] = useState(initialPick);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [isFavoriting, setIsFavoriting] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);

  async function handleRefresh() {
    setIsDrawing(true);
    setError(undefined);
    try {
      setPick(await drawRandomPhotoAction());
    } catch {
      // The action already turns a failed walk into a `reason`; this only catches the
      // request itself failing, which would otherwise leave the button spinning.
      setError("Couldn't draw another photo.");
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

  const hasPhoto = pick.relativePath !== undefined;
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
        // Three icon-only controls in one row: keep this photo, draw another, read the
        // kept ones back. All in `headerAction` so none of them toggles the card.
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

          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            disabled={isDrawing}
            title="Show a different photo"
            ariaLabel="Show a different photo"
          >
            <RefreshIcon className={`h-4 w-4 ${isDrawing ? "animate-spin" : ""}`} />
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsListOpen(true)}
            title="My favorite photos"
            ariaLabel="My favorite photos"
          >
            <TreeIcon name="heart-filled" className="h-4 w-4" />
            {/* The count is the one piece of text in this row: it tells the reader
                whether the list is worth opening before they open it. Hidden on a
                phone, where three glyphs and a number crowd the title. */}
            {favorites.length > 0 && (
              <span className="ml-1 text-xs max-lg:hidden">{favorites.length}</span>
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
          <button
            type="button"
            onClick={() => setIsLightboxOpen(true)}
            className="block w-full cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the bytes come from
                our own session-guarded route over an SMB share, not a static asset
                next/image can optimize. */}
            <img
              src={photoUrl(pick.relativePath)}
              alt={caption ?? "A photograph from the archive"}
              className="mx-auto max-h-[60vh] w-auto rounded-lg object-contain"
            />
          </button>

          <figcaption className="mt-3 text-center text-sm text-muted break-words">
            {caption}
          </figcaption>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </figure>
      ) : (
        <div>
          <p className="text-sm text-muted">{messageFor(pick)}</p>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}

      {/* One photo, so there is nothing to page through -- the lightbox is here for the
          full-size view, and its arrows hide themselves at a single-item list. */}
      {isLightboxOpen && pick.relativePath !== undefined && (
        <PhotoLightbox
          photos={[
            {
              src: photoUrl(pick.relativePath),
              caption: pick.name ?? "",
              subcaption: pick.folderName,
            },
          ]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}

      {/* Mounted only while open, so it re-reads on each visit rather than holding a
          stale list — and `initialFavorites` is the card's own state, which the toggle
          above keeps current. */}
      {isListOpen && (
        <FavPhotosDialog
          initialFavorites={favorites}
          onChanged={setFavorites}
          onClose={() => setIsListOpen(false)}
        />
      )}
    </CollapsibleCard>
  );
}
