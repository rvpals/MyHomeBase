// Which journal date a photograph in the viewer belongs to.
//
// The photo viewer offers an "Open Journal" link, and the only things it knows about a
// photograph are its file name and the name of the folder holding it. Turning those two
// strings into a date is a decision with an order to it, so it lives here rather than in
// the component: the fallback chain is the interesting part, and it is testable without
// mounting React.

import { dateFromFileName, dayFolderDateOf } from "./paths";

export interface PhotoJournalDateInput {
  /** The photograph's file name, e.g. `IMG_20190609_143501.jpg`. */
  photoName?: string;
  /** The name of the folder holding it, e.g. `2019-06-09 Von Thun Farm`. */
  folderName?: string;
}

/**
 * The `YYYY-MM-DD` a photograph should open the journal on, or `undefined`.
 *
 * THE FILE NAME WINS. It is per-photo, so it stays right inside a month folder, where
 * every picture carries a different day and the folder name knows only the month.
 *
 * The folder name is the fallback, for the day folder whose files are bare camera
 * counters (`DSC_0041.jpg`) -- there the folder is the only thing that knows the date,
 * and it knows it exactly. A MONTH folder is deliberately not consulted:
 * `dayFolderDateOf` rejects `2019-06` and `2019-01-00 San Diego Vacation`, because
 * "some day in June" is not a day to open a calendar on.
 *
 * `undefined` means the caller should not offer the link at all. A button that opens the
 * journal on a guessed date is worse than no button.
 */
export function photoJournalDate({
  photoName,
  folderName,
}: PhotoJournalDateInput): string | undefined {
  if (photoName !== undefined) {
    const fromName = dateFromFileName(photoName);
    if (fromName !== undefined) return fromName;
  }

  if (folderName !== undefined) {
    const fromFolder = dayFolderDateOf(folderName);
    if (fromFolder !== undefined) return fromFolder;
  }

  return undefined;
}
