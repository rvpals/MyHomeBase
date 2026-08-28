// Domain models for the photo archive a journal entry can be matched against.

/**
 * Why the configured photo root is or is not usable.
 *
 * Separate cases rather than a boolean because each one has a different fix, and the
 * screen should say which: set the path, correct it, grant the app's user access to the
 * share, or check that the NAS is answering.
 */
export type PhotoRootCheck =
  | { kind: "ok"; path: string }
  /** No photo folder has been set in the Journal's configuration. */
  | { kind: "not-configured" }
  /** The path does not exist -- a typo, or the wrong volume. */
  | { kind: "missing"; path: string }
  /** It exists but the app's user may not read it (DSM share ACLs). */
  | { kind: "no-permission"; path: string }
  /** It exists but is a file, not a folder. */
  | { kind: "not-a-directory"; path: string }
  /** Configured, but the filesystem call failed some other way. */
  | { kind: "unreachable"; path: string; code?: string };

/**
 * The "Check Access" report for the Journal configuration screen.
 *
 * Evidence, not a verdict: each field is the outcome of one step the photo card itself
 * takes, so a misconfiguration can be read off the report instead of guessed at. The
 * screen shows the year folders it actually found, which is the difference between
 * "trust me, it works" and proof.
 */
export interface PhotoArchiveDiagnosis {
  /** Whether the configured root is usable, and why not when it isn't. */
  rootCheck: PhotoRootCheck;
  /** Year-folder names found directly under the root, capped for display. */
  yearFolders: string[];
  /** How many there are in total, which may exceed the sample above. */
  yearFolderCount: number;
  truncatedYears: boolean;
  /** The year folder for the date being checked, e.g. `2016`. */
  sampleYear: string;
  sampleYearExists: boolean;
  /** Folder names inside `sampleYear`, capped for display. */
  sampleFolders: string[];
  sampleFolderCount: number;
  truncatedFolders: boolean;
  /**
   * JPEGs found in one of `sampleYear`'s folders -- the first non-empty one tried.
   *
   * The end-to-end proof: it shows that FILES are readable, not just directory names.
   * `undefined` when there was no folder to look in.
   */
  samplePhotoCount?: number;
  /**
   * Which folder `samplePhotoCount` came from, when a non-empty one was found.
   *
   * Named so the report can say *where* it saw photos — "48 in 2026-02-15 Chinese New
   * Year Lunch" is evidence; a bare count could have come from anywhere.
   */
  samplePhotoFolder?: string;
}

/**
 * Which of the archive's two folder conventions a match came from.
 *
 * The distinction is not cosmetic -- it decides how the folder's photos get found.
 * A `day` folder is entirely about one date, so every photo in it is a match and a
 * directory listing is the whole job. A `month` folder holds a whole month of loose
 * photos, so its contents have to be filtered by capture date, which costs a partial
 * read of every file in it.
 */
export type PhotoFolderKind = "day" | "month";

/** One folder in the archive that holds photos for the date being looked up. */
export interface PhotoFolder {
  /** The folder's own name, e.g. `2019-06-09 Von Thun Farm Strawberry Festival`. */
  name: string;
  /** Path from the photo root, e.g. `2019/2019-06-09 Von Thun Farm...`. */
  relativePath: string;
  kind: PhotoFolderKind;
  /**
   * The event description with the leading date stripped, for a day folder that has
   * one -- `Von Thun Farm Strawberry Festival Washington`. Empty when the folder is
   * named by date alone, or when it is a month folder.
   */
  label: string;
  /**
   * How many `.jpg`/`.jpeg` files the folder holds in total.
   *
   * For a month folder this is the whole month, NOT the number matching the date --
   * counting those means reading every file's EXIF, which is exactly the work this
   * cheap first pass exists to defer. The UI says "scan" rather than showing a count
   * for that reason.
   */
  photoCount: number;
  /**
   * The date this DAY folder was matched on, when the lookup was a range.
   *
   * A range lookup returns folders for many different days at once, so "which day is
   * this one?" can no longer be answered from the query -- the UI needs it to group
   * and label the results. `undefined` for a month folder, and for the single-date
   * lookup, where the query IS the answer.
   */
  matchedDate?: string;
  /** The `YYYY-MM` a MONTH folder was matched on, under the same reasoning. */
  matchedMonth?: string;
}

/** How a photo in a month folder came to be matched to the date. */
export type PhotoMatchSource = "exif" | "file-name" | "folder";

/** One photo to show in the grid. */
export interface PhotoFile {
  /** File name, e.g. `IMG_20190609_143501.jpg`. */
  name: string;
  /** Path from the photo root, for the image route to serve. */
  relativePath: string;
  /**
   * How this photo was matched.
   *
   * `folder` means membership alone was the evidence (a day folder, where the folder
   * name is the date). `exif` is the capture timestamp, `file-name` the fallback for
   * a photo whose metadata was stripped. Surfaced so the card can be honest about
   * why a photo appeared, rather than implying every match is equally certain.
   */
  matchedBy: PhotoMatchSource;
  /** The capture date read from EXIF, when there was one. */
  takenAt?: string;
}

/** The result of looking up which folders hold photos for a date. */
export interface PhotoFolderLookup {
  /**
   * Whether the photo root is configured AND readable.
   *
   * The quick answer for a caller that only needs to decide between "show folders" and
   * "show a problem"; `reason` says which problem, because the four causes have four
   * different fixes.
   */
  isAvailable: boolean;
  /**
   * Why the lookup found nothing.
   *
   * `no-year-folder` is an ordinary empty result (the archive simply has no folder for
   * that year); every other value is a configuration or access problem carried
   * verbatim from `PhotoRootCheck`, so the card can name the actual fix.
   */
  reason?: PhotoRootCheck["kind"] | "no-year-folder";
  /** The configured path, echoed back so the card can show what it tried. */
  rootPath?: string;
  /** Day folders first, then the month folder -- the order the card renders. */
  folders: PhotoFolder[];
}

/** The photos inside one folder that belong to the date being viewed. */
export interface PhotoFolderContents {
  relativePath: string;
  kind: PhotoFolderKind;
  photos: PhotoFile[];
  /**
   * For a month folder: how many files were examined to find `photos`.
   *
   * Reported so the card can say "12 of 340" -- a bare "12 photos" from a folder of
   * 340 looks like the scan failed rather than like it filtered.
   */
  examined: number;
  /**
   * True when a month folder was scanned and nothing matched the date.
   *
   * Distinct from an empty folder: it means the month has photos, just none from
   * this day, and the card offers to show the month instead.
   */
  isEmptyAfterFilter: boolean;
}
