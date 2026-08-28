import { describe, expect, it } from "vitest";
import {
  dateFromFileName,
  dayFolderDateOf,
  isDayFolderFor,
  isDayFolderInRange,
  isMonthFolderFor,
  isMonthFolderInRange,
  monthFolderMonthOf,
  yearFoldersInRange,
  isMonthPrecisionDayFolder,
  isPhotoFileName,
  isSafeRelativePath,
  monthFolderNameOf,
  normaliseRelativePath,
  resolvePhotoPath,
  yearFolderOf,
} from "./paths";

// Two jobs are tested here, and the first one matters more: this file is the guard
// between a browser request and an arbitrary file read, so the rejection cases come
// first. The second job is the archive's naming convention.

const POSIX_ROOT = "/volume1/MEDIA/PHOTO/BY YEAR";
const UNC_ROOT = "//NAS_DS223/MEDIA/PHOTO/BY YEAR";

describe("normaliseRelativePath", () => {
  it("converts backslashes and strips empty and dot segments", () => {
    expect(normaliseRelativePath(String.raw`2019\2019-06\IMG_1.jpg`)).toBe("2019/2019-06/IMG_1.jpg");
    expect(normaliseRelativePath("/2019//2019-06/./IMG_1.jpg/")).toBe("2019/2019-06/IMG_1.jpg");
  });

  it("leaves .. in place rather than resolving it", () => {
    // Resolving here would turn a traversal attempt into a valid-looking path;
    // isSafeRelativePath is what must reject it.
    expect(normaliseRelativePath("a/../b")).toBe("a/../b");
  });
});

describe("isSafeRelativePath", () => {
  it("accepts a folder name containing spaces", () => {
    // The archive's event folders are ALL like this, so a space must stay legal --
    // this is the case the music catalog's equivalent guard deliberately rejects.
    expect(isSafeRelativePath("2019/2019-06-09 Von Thun Farm Strawberry Festival Washington")).toBe(
      true,
    );
    expect(isSafeRelativePath("2019/2019-06-09 Von Thun Farm/IMG_20190609_143501.jpg")).toBe(true);
  });

  it("accepts non-ASCII names", () => {
    expect(isSafeRelativePath("2019/2019-08-15 中秋节/IMG_1.jpg")).toBe(true);
  });

  it("rejects traversal in any position", () => {
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("2019/../../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("2019/2019-06/..")).toBe(false);
    expect(isSafeRelativePath(String.raw`..\..\windows\system32`)).toBe(false);
  });

  it("rejects absolute, drive-letter and UNC paths", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:/Windows/System32/config/SAM")).toBe(false);
    expect(isSafeRelativePath(String.raw`c:\windows`)).toBe(false);
    // A UNC path normalises to a leading slash, so it is caught too.
    expect(isSafeRelativePath("//other-server/share/photo.jpg")).toBe(false);
  });

  it("rejects a NUL byte, which can truncate a native path", () => {
    expect(isSafeRelativePath("photo.jpg\0.txt")).toBe(false);
  });

  it("rejects blank input", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("   ")).toBe(false);
  });
});

describe("resolvePhotoPath", () => {
  it("joins onto a POSIX root, preserving spaces in both root and path", () => {
    expect(resolvePhotoPath(POSIX_ROOT, "2019/2019-06-09 Von Thun Farm/IMG_1.jpg")).toBe(
      "/volume1/MEDIA/PHOTO/BY YEAR/2019/2019-06-09 Von Thun Farm/IMG_1.jpg",
    );
  });

  it("keeps a UNC root's leading double slash", () => {
    expect(resolvePhotoPath(UNC_ROOT, "2019/2019-06")).toBe(
      "//NAS_DS223/MEDIA/PHOTO/BY YEAR/2019/2019-06",
    );
  });

  it("produces exactly one separator regardless of a trailing slash on the root", () => {
    expect(resolvePhotoPath(`${POSIX_ROOT}/`, "2019")).toBe(`${POSIX_ROOT}/2019`);
  });

  it("returns undefined for an unsafe path rather than throwing", () => {
    // The caller is a route serving an image: unsafe means 404, not 500.
    expect(resolvePhotoPath(POSIX_ROOT, "../../etc/passwd")).toBeUndefined();
    expect(resolvePhotoPath(POSIX_ROOT, "/etc/passwd")).toBeUndefined();
  });

  it("returns undefined when the root is unset", () => {
    expect(resolvePhotoPath("", "2019")).toBeUndefined();
    expect(resolvePhotoPath("   ", "2019")).toBeUndefined();
  });
});

describe("isPhotoFileName", () => {
  it("accepts jpg and jpeg in any case", () => {
    expect(isPhotoFileName("IMG_1.jpg")).toBe(true);
    expect(isPhotoFileName("IMG_1.JPG")).toBe(true);
    expect(isPhotoFileName("IMG_1.jpeg")).toBe(true);
    expect(isPhotoFileName("IMG_1.JPEG")).toBe(true);
  });

  it("rejects RAW, video and sidecar files", () => {
    // The archive holds these alongside the JPEGs and the card ignores them.
    expect(isPhotoFileName("IMG_1.CR2")).toBe(false);
    expect(isPhotoFileName("IMG_1.NEF")).toBe(false);
    expect(isPhotoFileName("IMG_1.arw")).toBe(false);
    expect(isPhotoFileName("IMG_1.heic")).toBe(false);
    expect(isPhotoFileName("MVI_1.mp4")).toBe(false);
    expect(isPhotoFileName("IMG_1.xmp")).toBe(false);
    expect(isPhotoFileName("Thumbs.db")).toBe(false);
  });

  it("rejects a name with no extension, and a dotfile", () => {
    expect(isPhotoFileName("IMG_1")).toBe(false);
    expect(isPhotoFileName(".jpg")).toBe(false);
  });
});

describe("yearFolderOf / monthFolderNameOf", () => {
  it("takes the year and month prefixes of a date", () => {
    expect(yearFolderOf("2019-06-09")).toBe("2019");
    expect(monthFolderNameOf("2019-06-09")).toBe("2019-06");
  });
});

describe("isDayFolderFor", () => {
  const date = "2019-06-09";

  it("matches the date alone and the date plus an event description", () => {
    expect(isDayFolderFor("2019-06-09", date)).toBe(true);
    expect(isDayFolderFor("2019-06-09 Von Thun Farm Strawberry Festival Washington", date)).toBe(
      true,
    );
  });

  it("matches the separators the archive actually uses", () => {
    expect(isDayFolderFor("2019-06-09_Trip", date)).toBe(true);
    expect(isDayFolderFor("2019-06-09-Trip", date)).toBe(true);
    expect(isDayFolderFor("2019-06-09.Trip", date)).toBe(true);
  });

  it("rejects a different day whose name merely starts with the same digits", () => {
    // The case a bare startsWith would get wrong.
    expect(isDayFolderFor("2019-06-090", date)).toBe(false);
    expect(isDayFolderFor("2019-06-0912", date)).toBe(false);
  });

  it("rejects another date, and the month folder", () => {
    expect(isDayFolderFor("2019-06-10 Von Thun Farm", date)).toBe(false);
    expect(isDayFolderFor("2019-06", date)).toBe(false);
    expect(isDayFolderFor("2018-06-09 Von Thun Farm", date)).toBe(false);
  });

  it("rejects a day-00 folder, which means month precision", () => {
    // `2019-01-00 San Diego Vacation` is "sometime in January", and the archive holds a
    // dozen of these. Treating it as the 1st would hand a whole vacation's photos to
    // whatever entry happened to be written that day.
    expect(isDayFolderFor("2019-01-00 San Diego Vacation", "2019-01-00")).toBe(false);
    expect(isDayFolderFor("2019-03-00 Spain Trip", "2019-03-00")).toBe(false);
  });
});

describe("isMonthPrecisionDayFolder", () => {
  it("recognises the YYYY-MM-00 form", () => {
    expect(isMonthPrecisionDayFolder("2019-01-00 San Diego Vacation")).toBe(true);
    expect(isMonthPrecisionDayFolder("2019-03-00")).toBe(true);
  });

  it("does not match a real day folder or a bare month folder", () => {
    expect(isMonthPrecisionDayFolder("2019-06-09 Von Thun Farm")).toBe(false);
    expect(isMonthPrecisionDayFolder("2019-06")).toBe(false);
    // A day of the 10th, not a `-00` marker.
    expect(isMonthPrecisionDayFolder("2019-06-10 Central Park")).toBe(false);
  });
});

describe("isMonthFolderFor", () => {
  it("matches the bare YYYY-MM folder", () => {
    expect(isMonthFolderFor("2019-06", "2019-06-09")).toBe(true);
    // Tolerates a stray space in the folder name, which a manual rename can leave.
    expect(isMonthFolderFor("2019-06 ", "2019-06-09")).toBe(true);
  });

  it("matches a named month folder, which the archive also contains", () => {
    // e.g. 2018/2018-05 Lake George Trip -- a trip nobody split into days.
    expect(isMonthFolderFor("2018-05 Lake George Trip", "2018-05-12")).toBe(true);
    expect(isMonthFolderFor("2017-12 Washington DC Trip", "2017-12-25")).toBe(true);
  });

  it("treats a day-00 folder as a month folder", () => {
    // Month precision: its photos have to earn their place by capture date.
    expect(isMonthFolderFor("2019-01-00 San Diego Vacation", "2019-01-15")).toBe(true);
    expect(isMonthFolderFor("2019-03-00 Spain Trip", "2019-03-02")).toBe(true);
  });

  it("does not treat a day folder as the month folder", () => {
    // A prefix test would match this, and it would then get the expensive EXIF scan
    // and have every photo filtered rather than shown.
    expect(isMonthFolderFor("2019-06-09 Von Thun Farm", "2019-06-09")).toBe(false);
    expect(isMonthFolderFor("2019-06-09", "2019-06-09")).toBe(false);
  });

  it("rejects another month", () => {
    expect(isMonthFolderFor("2019-07", "2019-06-09")).toBe(false);
  });
});

describe("dateFromFileName", () => {
  it("reads the separated forms", () => {
    expect(dateFromFileName("2019-06-09 12.34.56.jpg")).toBe("2019-06-09");
    expect(dateFromFileName("2019_06_09_143501.jpg")).toBe("2019-06-09");
    expect(dateFromFileName("2019.06.09-1.jpg")).toBe("2019-06-09");
  });

  it("reads the unseparated camera and phone forms", () => {
    expect(dateFromFileName("IMG_20190609_143501.jpg")).toBe("2019-06-09");
    expect(dateFromFileName("PXL_20190609_123456789.jpg")).toBe("2019-06-09");
    expect(dateFromFileName("IMG-20190609-WA0001.jpg")).toBe("2019-06-09");
    expect(dateFromFileName("20190609.jpg")).toBe("2019-06-09");
  });

  it("returns undefined for a counter that is not a date", () => {
    // The reason the month/day plausibility check exists -- these must not become
    // matches, or the fallback would invent photos for a date.
    expect(dateFromFileName("DSC_0001.jpg")).toBeUndefined();
    expect(dateFromFileName("IMG_99999999.jpg")).toBeUndefined();
    expect(dateFromFileName("IMG_20191345.jpg")).toBeUndefined();
  });

  it("returns undefined for an impossible calendar date", () => {
    expect(dateFromFileName("IMG_20190230_1.jpg")).toBeUndefined();
    expect(dateFromFileName("2019-02-30.jpg")).toBeUndefined();
  });

  it("returns undefined when there is no date at all", () => {
    expect(dateFromFileName("scan.jpg")).toBeUndefined();
    expect(dateFromFileName("")).toBeUndefined();
  });
});

// --- The range helpers -------------------------------------------------------
//
// Same convention as above, asked as an interval instead of an equality. The cases
// that matter are the boundaries (inclusive on both ends) and the two folder forms
// that look like each other -- a day folder and a month-precision `-00` folder.

describe("dayFolderDateOf", () => {
  it("reads the date out of a bare and a named day folder", () => {
    expect(dayFolderDateOf("2019-06-09")).toBe("2019-06-09");
    expect(dayFolderDateOf("2019-06-09 Von Thun Farm Strawberry Festival")).toBe("2019-06-09");
    expect(dayFolderDateOf("2019-06-09_Morning-Hike")).toBe("2019-06-09");
  });

  it("rejects a month folder, a month-precision folder and a mis-typed day", () => {
    expect(dayFolderDateOf("2019-06")).toBeUndefined();
    expect(dayFolderDateOf("2019-01-00 San Diego Vacation")).toBeUndefined();
    // No separator after the date: a different day, mis-typed.
    expect(dayFolderDateOf("2019-06-090")).toBeUndefined();
    // Not a real calendar date -- it would compare inside a range and match nothing.
    expect(dayFolderDateOf("2019-02-30 Impossible")).toBeUndefined();
    expect(dayFolderDateOf("Holiday Photos")).toBeUndefined();
  });
});

describe("monthFolderMonthOf", () => {
  it("reads the month out of all three month-folder forms", () => {
    expect(monthFolderMonthOf("2019-06")).toBe("2019-06");
    expect(monthFolderMonthOf("2018-05 Lake George Trip")).toBe("2018-05");
    expect(monthFolderMonthOf("2019-01-00 San Diego Vacation")).toBe("2019-01");
  });

  it("rejects a day folder", () => {
    // The whole point of the distinction: a day folder must not be sent down the
    // expensive EXIF path.
    expect(monthFolderMonthOf("2019-06-09 Von Thun Farm")).toBeUndefined();
    expect(monthFolderMonthOf("2019-13")).toBeUndefined();
    expect(monthFolderMonthOf("Holiday Photos")).toBeUndefined();
  });
});

describe("isDayFolderInRange", () => {
  it("includes both boundaries", () => {
    expect(isDayFolderInRange("2026-01-01 New Year", "2026-01-01", "2026-08-02")).toBe(true);
    expect(isDayFolderInRange("2026-08-02 Beach", "2026-01-01", "2026-08-02")).toBe(true);
  });

  it("excludes a day one outside either end", () => {
    expect(isDayFolderInRange("2025-12-31 Eve", "2026-01-01", "2026-08-02")).toBe(false);
    expect(isDayFolderInRange("2026-08-03 After", "2026-01-01", "2026-08-02")).toBe(false);
  });

  it("matches a single-day range, which is how the day button is expressed", () => {
    expect(isDayFolderInRange("2019-06-09 Von Thun Farm", "2019-06-09", "2019-06-09")).toBe(true);
    expect(isDayFolderInRange("2019-06-10 Next Day", "2019-06-09", "2019-06-09")).toBe(false);
  });

  it("is false for a month folder", () => {
    expect(isDayFolderInRange("2026-03", "2026-01-01", "2026-08-02")).toBe(false);
  });
});

describe("isMonthFolderInRange", () => {
  it("includes a month that only partly overlaps the range", () => {
    // The range stops on the 2nd, but August's folder holds the 1st and the 2nd.
    expect(isMonthFolderInRange("2026-08", "2026-01-01", "2026-08-02")).toBe(true);
    expect(isMonthFolderInRange("2026-01 Winter", "2026-01-15", "2026-03-04")).toBe(true);
  });

  it("excludes a month either side of the range", () => {
    expect(isMonthFolderInRange("2025-12", "2026-01-01", "2026-08-02")).toBe(false);
    expect(isMonthFolderInRange("2026-09", "2026-01-01", "2026-08-02")).toBe(false);
  });

  it("includes the month of a single-day range", () => {
    expect(isMonthFolderInRange("2019-06", "2019-06-09", "2019-06-09")).toBe(true);
  });

  it("is false for a day folder", () => {
    expect(isMonthFolderInRange("2026-03-15 Museum", "2026-01-01", "2026-08-02")).toBe(false);
  });
});

describe("yearFoldersInRange", () => {
  it("returns one year for a range inside one year", () => {
    expect(yearFoldersInRange("2026-01-01", "2026-08-02")).toEqual(["2026"]);
    expect(yearFoldersInRange("2026-08-02", "2026-08-02")).toEqual(["2026"]);
  });

  it("returns every year a range crosses, including ones with no photos", () => {
    // Every year is returned; whether its folder exists is the store's question.
    expect(yearFoldersInRange("2019-11-02", "2021-01-09")).toEqual(["2019", "2020", "2021"]);
  });

  it("returns nothing for an inverted range", () => {
    expect(yearFoldersInRange("2026-08-02", "2026-01-01")).toEqual([]);
  });
});
