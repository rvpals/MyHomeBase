import { describe, expect, it } from "vitest";
import { photoJournalDate } from "./viewer-date";

describe("photoJournalDate", () => {
  it("reads the date out of the file name", () => {
    expect(photoJournalDate({ photoName: "IMG_20190609_143501.jpg" })).toBe("2019-06-09");
    expect(photoJournalDate({ photoName: "2019-06-09 12.34.56.jpg" })).toBe("2019-06-09");
  });

  it("prefers the file name over the folder", () => {
    // The case this ordering exists for: a month folder where every photo is a
    // different day. Trusting the folder would open the journal on the wrong day for
    // all but one of them.
    expect(
      photoJournalDate({
        photoName: "IMG_20190612_090000.jpg",
        folderName: "2019-06-09 Von Thun Farm",
      }),
    ).toBe("2019-06-12");
  });

  it("falls back to a day folder when the file name carries no date", () => {
    expect(
      photoJournalDate({ photoName: "DSC_0041.jpg", folderName: "2019-06-09 Von Thun Farm" }),
    ).toBe("2019-06-09");
  });

  it("gives up on a month folder full of counter file names", () => {
    // "Some day in June" is not a day to open a calendar on, so the caller is told to
    // offer no link rather than guess the 1st.
    expect(photoJournalDate({ photoName: "DSC_0041.jpg", folderName: "2019-06" })).toBeUndefined();
    expect(
      photoJournalDate({ photoName: "DSC_0041.jpg", folderName: "2019-01-00 San Diego Vacation" }),
    ).toBeUndefined();
  });

  it("gives up when it knows nothing", () => {
    expect(photoJournalDate({})).toBeUndefined();
    expect(photoJournalDate({ photoName: "scan.jpg" })).toBeUndefined();
    expect(photoJournalDate({ photoName: "scan.jpg", folderName: "Old Prints" })).toBeUndefined();
  });
});
