"use client";

import { useState } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { JournalPhotosHost } from "../../journal-photos-host";

// Resolved once at module scope; the registry is static, so this is not I/O.
const PHOTOS_SLOT = getIconSlot("journal_card_entry_photos")!;

// "Pictures of this date" — the entry viewer's card for photographs taken on the day
// the entry describes.
//
// Now a two-line wrapper over the registered `PhotoOfTheDay` dialog, which was
// extracted from what used to live here. The folder list, the thumbnail grid, the
// lightbox, the four photo-root problem messages and the "show the whole month" escape
// hatch all moved there unchanged; the calendar's day and month buttons open the same
// dialog, so there is one implementation rather than two that drift.
//
// What stays here is the one thing that is genuinely this screen's: an entry page shows
// the card whether or not anyone wants photographs, so nothing touches the NAS — a
// share that can be slow or offline — until the reader asks.
//
// EXPANDING THE CARD IS THAT ASK. It is collapsed by default, so opening it is already
// an explicit "show me the photographs" — a button inside saying the same thing again
// was one click of pure ceremony. The card is therefore controlled rather than
// self-managing: its open state IS whether the dialog is up.

/** `2019-06-09` -> `06-09-2019`, the format the card's title shows. */
function toDisplayDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

export function JournalPhotosCard({ date }: { date: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <CollapsibleCard
        title={`Pictures of this date (${toDisplayDate(date)})`}
        titleIcon={<SlotIcon slot={PHOTOS_SLOT} className="h-4 w-4" />}
        open={isOpen}
        onOpenChange={setIsOpen}
      >
        {/* The body is never seen in practice — the dialog covers the card the moment
            it opens, and closing the dialog collapses the card again. It is here so
            that an expanded card is not an empty box in the one frame between the two,
            and so the card still says what it does if the dialog ever fails to mount. */}
        <p className="text-xs text-muted">
          Looking in the photo archive for folders from this date…
        </p>
      </CollapsibleCard>

      {isOpen ? (
        // `autoLookup` because expanding the card already was the "go and look"
        // instruction. Closing the dialog collapses the card, so the pair stay in step
        // and re-opening it scans again rather than showing a stale folder list.
        <JournalPhotosHost date={date} autoLookup onClose={() => setIsOpen(false)} />
      ) : null}
    </>
  );
}
