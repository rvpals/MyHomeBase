// Path handling and folder-naming rules for the photo archive, plus the guard that
// keeps a value from a browser request from reaching outside the photo root.
//
// Pure string logic on purpose -- no `node:path`, no filesystem. That makes both the
// traversal rules and the naming convention testable directly, which matters because
// this is the file standing between a request parameter and an arbitrary file read.
//
// The archive's convention (photo root -> year folder -> two kinds of folder):
//
//   BY YEAR/
//     2019/
//       2019-06/                                     <- a month's loose photos
//       2019-06-09 Von Thun Farm Strawberry Festival  <- one day's event
//
// A day folder ALWAYS starts `YYYY-MM-DD`; a month folder is exactly `YYYY-MM`.

/** The image extensions the journal card considers. RAW and video are ignored. */
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg"]);

/**
 * Normalises a path to the archive's stored form: forward slashes, no leading or
 * trailing slash, no `.` segments, no repeated slashes.
 *
 * `..` segments are NOT resolved here -- they are rejected by `isSafeRelativePath`.
 * Resolving them would silently turn a traversal attempt into a valid-looking path,
 * which is exactly the failure this pair of functions exists to prevent.
 */
export function normaliseRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/**
 * Whether a relative path is safe to join onto the photo root.
 *
 * Unlike the music catalog's equivalent, a SPACE IS LEGAL here -- and that is not an
 * oversight to be "fixed". Every event folder in this archive is named
 * `2019-06-09 Von Thun Farm Strawberry Festival Washington`, so rejecting spaces
 * would reject the entire feature. What is rejected is anything that could escape
 * the root or address something other than a plain relative file:
 *
 * - `..` in any segment -- the traversal case.
 * - An absolute POSIX path (`/etc/passwd`).
 * - A Windows drive or UNC path (`C:/...`, `//server/share`).
 * - A NUL byte, which can truncate a path inside a native filesystem call.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.trim() === "") return false;
  if (relativePath.includes("\0")) return false;

  const withForwardSlashes = relativePath.replace(/\\/g, "/");
  if (withForwardSlashes.startsWith("/")) return false;
  // A drive letter (`C:`) or any other scheme-ish prefix.
  if (/^[a-zA-Z]:/.test(withForwardSlashes)) return false;

  return normaliseRelativePath(withForwardSlashes)
    .split("/")
    .every((segment) => segment !== "..");
}

/**
 * Joins a relative path onto the configured photo root, or returns `undefined` when
 * the path is not safe.
 *
 * `undefined` rather than a thrown error: the caller is a route serving an image, and
 * an unsafe path is a 404 to the viewer, not a 500. The route must treat `undefined`
 * as "no such photo" and never fall back to an unchecked join.
 *
 * The root keeps its own separators, so a Windows UNC root (`//NAS_DS223/MEDIA/PHOTO/BY YEAR`)
 * and a POSIX root (`/volume1/MEDIA/PHOTO/BY YEAR`) both work -- Node accepts forward
 * slashes on both platforms.
 */
export function resolvePhotoPath(photoRoot: string, relativePath: string): string | undefined {
  if (!isSafeRelativePath(relativePath)) return undefined;

  const root = normaliseRoot(photoRoot);
  if (root === "") return undefined;

  return `${root}/${normaliseRelativePath(relativePath)}`;
}

/**
 * The root with backslashes folded to forward slashes and any trailing slash removed,
 * so joining always produces exactly one separator.
 *
 * A leading `//` is preserved -- that is a UNC host, not a redundant slash.
 *
 * A blank or whitespace-only root normalises to `""`, which callers treat as "not
 * configured". Trimming matters: an env var set to `"   "` would otherwise join into
 * the path `   /2019` and be handed to the filesystem.
 */
function normaliseRoot(photoRoot: string): string {
  return photoRoot.trim().replace(/\\/g, "/").replace(/[/]+$/, "");
}

/** Whether a file name is one of the image types this feature reads. */
export function isPhotoFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return false;
  return PHOTO_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

/**
 * The year folder an entry's date lives under -- `"2019-06-09"` -> `"2019"`.
 *
 * Only the year folder is ever read, never the whole root: the archive files a photo
 * under the year it was taken, so scanning further would cost a full-archive walk to
 * find nothing.
 */
export function yearFolderOf(date: string): string {
  return date.slice(0, 4);
}

/** The `YYYY-MM` prefix of a date -- the month folder's exact name. */
export function monthFolderNameOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Whether a folder name is the day folder for `date`.
 *
 * The name must START with the date, and what follows must be a separator or nothing
 * -- so `2019-06-09` and `2019-06-09 Von Thun Farm` match, while `2019-06-090` (a
 * different day, mis-typed) does not.
 */
export function isDayFolderFor(folderName: string, date: string): boolean {
  // `2019-01-00 San Diego Vacation` is month precision, not the 1st of January -- and
  // `startsWith` alone would not tell the difference for a date ending `-00`.
  if (isMonthPrecisionDayFolder(folderName)) return false;
  if (!folderName.startsWith(date)) return false;
  const rest = folderName.slice(date.length);
  return rest === "" || /^[\s._-]/.test(rest);
}

/**
 * Whether a folder name is a month folder for `date`.
 *
 * Matches the bare `2019-06` and the named form `2018-05 Lake George Trip` -- the
 * archive contains both, the second for a trip spanning days nobody split up. Both are
 * treated the same way: a month's worth of loose photos to be filtered by capture date.
 *
 * A `YYYY-MM-DD` day folder is explicitly NOT a month folder, even though it also
 * starts `YYYY-MM`. Confusing the two would send a day's event photos down the
 * expensive EXIF path and then filter most of them out, when the folder name already
 * said every photo in it belonged to the date.
 *
 * A **day-00** folder (`2019-01-00 San Diego Vacation`, "sometime in January") is
 * treated as a month folder too -- day `00` is not a real day, so its photos have to
 * earn their place by capture date like any other loose month.
 */
export function isMonthFolderFor(folderName: string, date: string): boolean {
  const trimmed = folderName.trim();
  const month = monthFolderNameOf(date);
  if (!trimmed.startsWith(month)) return false;

  const rest = trimmed.slice(month.length);
  // Bare `2019-06`, or `2019-06 <description>`.
  if (rest === "" || /^[\s._]/.test(rest)) return true;

  // `2019-06-00 <description>` -- a month-precision folder wearing a day slot.
  return /^-00(?:[\s._-]|$)/.test(rest);
}

/**
 * Whether a folder name carries month precision only -- `YYYY-MM-00`.
 *
 * Kept separate from `isMonthFolderFor` because it is a property of the NAME, not a
 * question about a date: `isDayFolderFor` has to reject these, or `2019-01-00` would
 * match an entry dated the 1st of January and claim a whole vacation's photos were
 * taken that day.
 */
export function isMonthPrecisionDayFolder(folderName: string): boolean {
  return /^\d{4}-\d{2}-00(?:[\s._-]|$)/.test(folderName.trim());
}

/**
 * The `YYYY-MM-DD` date embedded in a file name, or `undefined` when there is none.
 *
 * The fallback for a photo in a month folder that carries no EXIF timestamp -- a
 * scan, an export, or anything a tool has stripped. Recognises the forms this archive
 * actually contains:
 *
 *   IMG_20190609_143501.jpg   PXL_20190609_...   20190609.jpg
 *   2019-06-09 12.34.56.jpg   2019_06_09_...     IMG-20190609-WA0001.jpg
 *
 * A bare 8-digit run is only read as a date when its month and day are plausible,
 * because plenty of camera files are just a counter (`DSC_00010609.jpg`). That check
 * is what keeps the fallback from inventing matches.
 */
export function dateFromFileName(fileName: string): string | undefined {
  const separated = fileName.match(/(\d{4})[-_.](\d{2})[-_.](\d{2})/);
  if (separated) {
    const candidate = `${separated[1]}-${separated[2]}-${separated[3]}`;
    if (isPlausibleDate(candidate)) return candidate;
  }

  // Unseparated: require a non-digit boundary so a longer counter is not sliced up.
  const compact = fileName.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) {
    const candidate = `${compact[1]}-${compact[2]}-${compact[3]}`;
    if (isPlausibleDate(candidate)) return candidate;
  }

  return undefined;
}

/**
 * Whether `YYYY-MM-DD` is a real calendar date in a range a photo could carry.
 *
 * Round-tripping through `Date` rejects 2019-02-30, which a range check on the parts
 * would accept.
 */
function isPlausibleDate(candidate: string): boolean {
  const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  if (year < 1900 || year > 2200) return false;

  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === candidate;
}

/**
 * Whether a folder name is a day folder whose date falls inside `from..to` inclusive.
 *
 * The range counterpart of `isDayFolderFor`. It reads the date out of the name and
 * compares it, rather than testing the name against every date in the range: an
 * eight-month range holds 240-odd dates, and `startsWith` against each of them would
 * be 240 string comparisons per folder to answer what one interval test answers.
 *
 * ISO dates compare correctly as strings, which is why no parsing is needed -- the
 * whole archive convention is built on that property.
 */
export function isDayFolderInRange(folderName: string, from: string, to: string): boolean {
  const date = dayFolderDateOf(folderName);
  if (date === undefined) return false;
  return date >= from && date <= to;
}

/**
 * Whether a folder name is a month folder for any month the range touches.
 *
 * A month folder is included when its month OVERLAPS the range, not when the range
 * contains the whole month -- a range ending on the 2nd of August still wants
 * `2026-08`, because photos from the 1st and 2nd are in it. Which of its photos
 * actually belong is settled later by the EXIF scan, not here.
 */
export function isMonthFolderInRange(folderName: string, from: string, to: string): boolean {
  const month = monthFolderMonthOf(folderName);
  if (month === undefined) return false;
  return month >= monthFolderNameOf(from) && month <= monthFolderNameOf(to);
}

/**
 * The `YYYY-MM-DD` a day folder is named for, or `undefined` when the name is not a
 * day folder at all.
 *
 * Rejects a month-precision `YYYY-MM-00` folder for the same reason `isDayFolderFor`
 * does: day `00` is not a day, and treating it as one would file a whole vacation on
 * the 31st of the previous month or on nothing.
 */
export function dayFolderDateOf(folderName: string): string | undefined {
  const trimmed = folderName.trim();
  if (isMonthPrecisionDayFolder(trimmed)) return undefined;

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[\s._-].*)?$/);
  if (!match) return undefined;

  // A real calendar date, so `2019-06-31 Something` is not offered as a day folder --
  // it would compare inside a range and then match no photo.
  return isPlausibleDate(match[1]) ? match[1] : undefined;
}

/**
 * The `YYYY-MM` a month folder is named for, or `undefined` when the name is not a
 * month folder.
 *
 * Accepts all three forms the archive contains: the bare `2019-06`, the named
 * `2018-05 Lake George Trip`, and the month-precision `2019-01-00 San Diego Vacation`.
 */
export function monthFolderMonthOf(folderName: string): string | undefined {
  const trimmed = folderName.trim();

  // The separator after the month must NOT be a hyphen: `2019-06-09 Von Thun Farm` is a
  // DAY folder, and a `-` in the separator class would let its `-09` be swallowed as
  // part of the description -- which is exactly how a day folder gets mistaken for a
  // month and sent down the expensive EXIF path. Only the explicit `-00` group may
  // consume a hyphen here.
  const match = trimmed.match(/^(\d{4}-\d{2})(?:-00)?(?:[\s._](?:.*)?)?$/);
  if (!match) return undefined;
  const month = match[1];
  return isPlausibleDate(`${month}-01`) ? month : undefined;
}

/**
 * Every year folder a date range touches, in order -- `2019-11-02`..`2021-01-09` ->
 * `["2019", "2020", "2021"]`.
 *
 * The archive files a photo under the year it was taken, so these are the only
 * folders a range lookup ever needs to read. Returns `[]` when the range is inverted,
 * which callers treat as an empty result rather than as an error.
 */
export function yearFoldersInRange(from: string, to: string): string[] {
  if (to < from) return [];

  const first = Number(yearFolderOf(from));
  const last = Number(yearFolderOf(to));
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];

  const years: string[] = [];
  for (let year = first; year <= last; year += 1) years.push(String(year));
  return years;
}
