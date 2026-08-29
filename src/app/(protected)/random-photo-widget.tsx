"use client";

// One-off home-screen widget (not a registered shared component), mirroring
// daily-quote-widget.tsx: the server draws the first photograph, and the refresh button
// draws another without reloading the page, so only the picture changes.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type { RandomPhotoPick } from "@/lib/journal-photos";
import { drawRandomPhotoAction } from "./random-photo-actions";

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

export function RandomPhotoWidget({
  initialPick,
  className,
}: {
  /** The photograph drawn on the server for this page load. */
  initialPick: RandomPhotoPick;
  /** Spacing is the caller's call, as with the other home-screen cards. */
  className?: string;
}) {
  const [pick, setPick] = useState(initialPick);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

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

  const hasPhoto = pick.relativePath !== undefined;
  const caption = pick.folderName !== undefined ? `${pick.folderName} / ${pick.name}` : pick.name;

  return (
    // Open by default, unlike the Daily Quote: the picture IS the card, and one that
    // opens shut would only ever show its own title. The refresh button lives in
    // `headerAction` so it stays reachable and doesn't toggle the card.
    <CollapsibleCard
      title="Random photo"
      titleIcon={
        RANDOM_PHOTO_SLOT ? <SlotIcon slot={RANDOM_PHOTO_SLOT} className="h-4 w-4" /> : undefined
      }
      className={className}
      defaultOpen
      headerAction={
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={isDrawing}>
          <RefreshIcon className={`h-4 w-4 ${isDrawing ? "animate-spin" : ""}`} />
          {/* Icon-only control, so the accessible name comes from this label. */}
          <span className="sr-only">Show a different photo</span>
        </Button>
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
    </CollapsibleCard>
  );
}
