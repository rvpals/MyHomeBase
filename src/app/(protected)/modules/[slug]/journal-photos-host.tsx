// The one place that wires the journal's photo server actions to the reusable
// `PhotoOfTheDay` dialog.
//
// It exists because `src/components/` may not import a server action (ARCHITECTURE.md
// → the component is pure presentation, props in and events out). Rather than have the
// calendar and the entry viewer each repeat the same four bindings, both call this.
//
// No logic of its own beyond dispatching one query shape to one of two action pairs.

"use client";

import {
  PhotoOfTheDay,
  type PhotoDateRange,
  type PhotoQuery,
} from "@/components/photo-of-the-day";
import {
  findPhotoFoldersAction,
  findPhotoFoldersInRangeAction,
  listPhotosInFolderAction,
  listPhotosInFolderForRangeAction,
} from "./entries/[id]/journal-photos-actions";

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

export interface JournalPhotosHostProps {
  /** A single day, `YYYY-MM-DD`. Pass this or `range`, not both. */
  date?: string;
  /** A span of days. Pass this or `date`, not both. */
  range?: PhotoDateRange;
  /** Returns the reader to the screen that opened the dialog. */
  onClose: () => void;
  /** Start looking on mount. True for the calendar's buttons — see the dialog's prop. */
  autoLookup?: boolean;
}

export function JournalPhotosHost({ date, range, onClose, autoLookup }: JournalPhotosHostProps) {
  return (
    <PhotoOfTheDay
      date={date}
      range={range}
      onClose={onClose}
      autoLookup={autoLookup}
      photoUrl={photoUrl}
      onFindFolders={(query) =>
        // A single date and a range are two different actions rather than one taking
        // `from === to`, so each boundary validates the question it was actually asked.
        "date" in query
          ? findPhotoFoldersAction(query.date)
          : findPhotoFoldersInRangeAction(query.from, query.to)
      }
      onListPhotos={(query: PhotoQuery, relativePath, includeAll) =>
        "date" in query
          ? listPhotosInFolderAction(query.date, relativePath, includeAll)
          : listPhotosInFolderForRangeAction(query.from, query.to, relativePath, includeAll)
      }
    />
  );
}
