import {
  dayFolderDateOf,
  isDayFolderInRange,
  isMonthFolderInRange,
  monthFolderMonthOf,
  yearFoldersInRange,
} from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoFolder, PhotoFolderLookup } from "./types";

// The range use-case: which folders in the archive hold photos for a span of dates.
//
// The generalisation of `listPhotoFoldersForDate`, and the reason it exists as its own
// function rather than as a loop over that one: a range of eight months spans eight
// month folders and dozens of day folders, and asking the single-date question 240
// times would re-read the same year folder 240 times over an SMB share. Here each year
// folder in the range is read exactly ONCE and every name in it tested against the
// interval, so the cost is one directory read per year regardless of how wide the
// range is.
//
// Same two-phase design as the single-date path: this is the cheap pass (names and a
// photo count only). Nothing reads a photo's bytes until a folder is actually opened.

/**
 * The folders holding photos anywhere in `from..to` inclusive.
 *
 * Day folders first and month folders last, each group in date order -- the same
 * confidence ordering the single-date lookup uses, extended across the range so the
 * result reads chronologically rather than by whichever year folder answered first.
 *
 * An inverted range (`to` before `from`) returns an ordinary empty result rather than
 * throwing: the schema rejects it at the boundary, and a use-case that quietly finds
 * nothing is the safer behaviour for any caller that skipped validation.
 */
export async function listPhotoFoldersForRange(
  store: PhotoFileStore,
  input: { from: string; to: string },
): Promise<PhotoFolderLookup> {
  const { from, to } = input;

  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    return {
      isAvailable: false,
      reason: rootCheck.kind,
      rootPath: "path" in rootCheck ? rootCheck.path : undefined,
      folders: [],
    };
  }

  const years = yearFoldersInRange(from, to);

  const dayFolders: PhotoFolder[] = [];
  const monthFolders: PhotoFolder[] = [];
  let anyYearFolderExists = false;

  for (const year of years) {
    // A range crossing a year boundary will usually have a folder for one year and not
    // the other, so a missing year is skipped rather than reported -- `no-year-folder`
    // is only the answer when NONE of the range's years are filed.
    if (!(await store.folderExists(year))) continue;
    anyYearFolderExists = true;

    for (const name of await store.listFolderNames(year)) {
      const dayDate = isDayFolderInRange(name, from, to) ? dayFolderDateOf(name) : undefined;
      const monthOfFolder =
        dayDate === undefined && isMonthFolderInRange(name, from, to)
          ? monthFolderMonthOf(name)
          : undefined;
      if (dayDate === undefined && monthOfFolder === undefined) continue;

      const relativePath = `${year}/${name}`;
      const photoCount = (await store.listPhotoNames(relativePath)).length;

      // Same rule as the single-date lookup: a folder matching by name but holding no
      // JPEGs is dropped rather than offered as "0 photos".
      if (photoCount === 0) continue;

      const isDay = dayDate !== undefined;
      const folder: PhotoFolder = {
        name,
        relativePath,
        kind: isDay ? "day" : "month",
        label: labelOfFolder(name, isDay ? dayDate : `${monthOfFolder}-00`),
        photoCount,
        matchedDate: isDay ? dayDate : undefined,
        matchedMonth: isDay ? undefined : monthOfFolder,
      };

      if (isDay) dayFolders.push(folder);
      else monthFolders.push(folder);
    }
  }

  dayFolders.sort(byNameAscending);
  monthFolders.sort(byNameAscending);

  return {
    isAvailable: true,
    reason: anyYearFolderExists ? undefined : "no-year-folder",
    rootPath: rootCheck.path,
    folders: [...dayFolders, ...monthFolders],
  };
}

function byNameAscending(left: PhotoFolder, right: PhotoFolder): number {
  return left.name.localeCompare(right.name);
}

/**
 * The description part of a folder's name, with the leading date and any separator
 * stripped. `""` when the folder is named by date alone.
 *
 * The range version strips the date it actually MATCHED, not a date derived from the
 * query -- across a range each folder carries a different one, so there is no single
 * prefix to slice off the way the single-date path can.
 */
function labelOfFolder(folderName: string, matchedPrefix: string): string {
  const trimmed = folderName.trim();

  // A month folder matched as `2019-06-00`: the name may be the bare `2019-06`, so the
  // longer form is tried first and the shorter one is the fallback.
  const prefix = trimmed.startsWith(matchedPrefix) ? matchedPrefix : matchedPrefix.slice(0, 7);

  return trimmed
    .slice(prefix.length)
    .replace(/^(?:-00)?[\s._-]*/, "")
    .trim();
}
