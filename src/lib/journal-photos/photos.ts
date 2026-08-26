import { EXIF_HEADER_BYTES, readExifDate } from "./exif";
import {
  dateFromFileName,
  isDayFolderFor,
  isMonthFolderFor,
  monthFolderNameOf,
  yearFolderOf,
} from "./paths";
import type { PhotoFileStore } from "./ports";
import type {
  PhotoFile,
  PhotoFolder,
  PhotoFolderContents,
  PhotoFolderLookup,
} from "./types";

// Use-cases: given a journal entry's date, which folders in the archive hold photos
// from that day, and which photos inside one of them belong to it.
//
// Split into two calls rather than one on purpose. Listing the folders is cheap -- one
// directory read of the year folder, matching on names alone. Listing a MONTH folder's
// photos is not: it reads the head of every JPEG in the folder to check its EXIF date.
// Doing both in one call would make the button feel broken on an entry whose month
// folder holds 400 photos, so the card asks for the folders first and scans a folder
// only when it is opened.

/**
 * The folders holding photos for `date`, in the order the card should show them.
 *
 * Only the year folder is read -- `2019/` for a 2019 entry. The archive files photos
 * under the year they were taken, so searching wider would cost a full-archive walk to
 * find nothing extra.
 *
 * Day folders come first and the month folder last, because that is the confidence
 * order: a folder named `2019-06-09 Von Thun Farm` IS the day, whereas the month
 * folder merely might contain something from it.
 */
export async function listPhotoFoldersForDate(
  store: PhotoFileStore,
  date: string,
): Promise<PhotoFolderLookup> {
  // The specific reason, not just "unavailable" — an unset env var, a wrong path, and a
  // share the app's user cannot read need three different fixes, and the card says which.
  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    return {
      isAvailable: false,
      reason: rootCheck.kind,
      rootPath: "path" in rootCheck ? rootCheck.path : undefined,
      folders: [],
    };
  }

  const year = yearFolderOf(date);
  if (!(await store.folderExists(year))) {
    // Not an error: an entry from a year with no photos filed is an ordinary case,
    // and the card says so rather than showing a failure.
    return {
      isAvailable: true,
      reason: "no-year-folder",
      rootPath: rootCheck.path,
      folders: [],
    };
  }

  const names = await store.listFolderNames(year);

  const dayFolders: PhotoFolder[] = [];
  const monthFolders: PhotoFolder[] = [];

  for (const name of names) {
    const isDay = isDayFolderFor(name, date);
    const isMonth = !isDay && isMonthFolderFor(name, date);
    if (!isDay && !isMonth) continue;

    const relativePath = `${year}/${name}`;
    const photoCount = (await store.listPhotoNames(relativePath)).length;

    // A folder that matches by name but holds no JPEGs is dropped rather than listed
    // as "0 photos" -- offering a folder that opens onto nothing is worse than not
    // mentioning it. (RAW-only folders are the real case here.)
    if (photoCount === 0) continue;

    const folder: PhotoFolder = {
      name,
      relativePath,
      kind: isDay ? "day" : "month",
      label: labelOfFolder(name, date, isDay),
      photoCount,
    };

    if (isDay) dayFolders.push(folder);
    else monthFolders.push(folder);
  }

  dayFolders.sort((left, right) => left.name.localeCompare(right.name));

  return {
    isAvailable: true,
    rootPath: rootCheck.path,
    folders: [...dayFolders, ...monthFolders],
  };
}

/**
 * The photos inside one folder that belong to `date`.
 *
 * The two folder kinds are answered differently, which is the whole point of tracking
 * the kind:
 *
 * - A **day folder** is named for the date, so every JPEG in it matches. Directory
 *   listing only -- no file is opened.
 * - A **month folder** holds a whole month loose, so each JPEG's capture date is read
 *   from the head of the file (EXIF `DateTimeOriginal`), falling back to a date in the
 *   file name when the metadata was stripped.
 *
 * `includeAll` overrides the month filter, for the card's "show the whole month"
 * escape hatch after a scan matches nothing.
 */
export async function listPhotosInFolder(
  store: PhotoFileStore,
  input: { date: string; relativePath: string; includeAll?: boolean },
): Promise<PhotoFolderContents> {
  const { date, relativePath, includeAll = false } = input;

  const kind = folderKindOf(relativePath, date);
  const names = await store.listPhotoNames(relativePath);

  if (kind === "day" || includeAll) {
    return {
      relativePath,
      kind,
      // Membership is the evidence -- either the folder name carries the date, or the
      // caller asked for the whole month regardless of date.
      photos: names.map((name) => ({
        name,
        relativePath: `${relativePath}/${name}`,
        matchedBy: "folder" as const,
      })),
      examined: names.length,
      isEmptyAfterFilter: false,
    };
  }

  // Scanned in parallel batches, not one at a time. The cost here is SMB round-trip
  // LATENCY, not bytes: measured against the real archive, a cold 1,187-photo folder
  // took ~13s sequentially and a fraction of that with several reads in flight, because
  // each file is a separate request to the NAS and they were being paid for one by one.
  // Bounded rather than unbounded (`Promise.all` over 1,187 files) so a big folder
  // cannot open a thousand handles at once and starve the share.
  const matches: (PhotoFile | undefined)[] = [];
  for (let start = 0; start < names.length; start += SCAN_CONCURRENCY) {
    const batch = names.slice(start, start + SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map((name) => matchPhoto(store, relativePath, name, date)),
    );
    matches.push(...results);
  }

  // Filtered after the fact so the output keeps the sorted order of `names` — a batch
  // resolving out of order must not shuffle the grid.
  const photos = matches.filter((photo): photo is PhotoFile => photo !== undefined);

  return {
    relativePath,
    kind,
    photos,
    examined: names.length,
    isEmptyAfterFilter: photos.length === 0 && names.length > 0,
  };
}

/**
 * How many photo headers to read at once during a month scan.
 *
 * Eight because the constraint is the share's round-trip latency rather than local CPU
 * or bandwidth: enough requests in flight to hide the latency, few enough that a
 * thousand-photo folder does not flood the NAS or hold a thousand file handles open.
 */
const SCAN_CONCURRENCY = 8;

/**
 * Whether one photo belongs to `date`, and on what evidence -- `undefined` when it
 * does not.
 *
 * EXIF is authoritative when present, INCLUDING when it disagrees with the file name,
 * which is why a non-matching timestamp is not retried against the name. A photo
 * stamped 2019-06-10 in a file called `IMG_20190609_235959` was taken just after
 * midnight, and honouring the name would file it on the wrong journal entry.
 */
async function matchPhoto(
  store: PhotoFileStore,
  relativeFolder: string,
  name: string,
  date: string,
): Promise<PhotoFile | undefined> {
  const relativePath = `${relativeFolder}/${name}`;

  const header = await store.readHeader(relativePath, EXIF_HEADER_BYTES);
  const takenAt = header === undefined ? undefined : readExifDate(header);

  if (takenAt !== undefined) {
    return takenAt === date ? { name, relativePath, matchedBy: "exif", takenAt } : undefined;
  }

  // No readable EXIF: fall back to a date in the file name.
  return dateFromFileName(name) === date
    ? { name, relativePath, matchedBy: "file-name" }
    : undefined;
}

/**
 * Which convention a folder path follows, judged from its last segment.
 *
 * Re-derived from the path rather than trusted from the caller: this decides whether
 * the expensive EXIF scan runs, and a client that mislabels a 400-photo month folder
 * as a day folder would otherwise return the whole month as matches.
 */
function folderKindOf(relativePath: string, date: string): "day" | "month" {
  const name = relativePath.split("/").pop() ?? "";
  if (isMonthFolderFor(name, date)) return "month";
  if (isDayFolderFor(name, date)) return "day";
  // Neither convention: treat it as a month folder, the conservative choice -- it
  // filters by capture date instead of declaring every photo a match.
  return "month";
}

/**
 * The description part of a folder's name, with the leading date and any separator
 * removed. `""` when the folder is named by date alone.
 *
 * Month folders get this too, not just day folders: the archive holds named months
 * like `2018-05 Lake George Trip` and `2019-01-00 San Diego Vacation`, and dropping
 * their description would leave the card showing a bare `2018-05` for a folder whose
 * name says exactly what it is.
 */
function labelOfFolder(folderName: string, date: string, isDay: boolean): string {
  const prefix = isDay ? date : monthFolderNameOf(date);
  return folderName
    .trim()
    .slice(prefix.length)
    // Also strips the `-00` of a month-precision folder, which is part of the date
    // rather than part of the description.
    .replace(/^(?:-00)?[\s._-]*/, "")
    .trim();
}

/**
 * The month folder's name for a date -- exported so the card can say which month it
 * is offering to show without re-deriving the convention in the presentation layer.
 */
export function monthFolderLabel(date: string): string {
  return monthFolderNameOf(date);
}
