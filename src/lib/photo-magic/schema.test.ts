import { describe, expect, it } from "vitest";
import {
  generatePhotoMagicSchema,
  photoMagicCriteriaSchema,
  photoMagicListUpdateSchema,
  photoMagicListWriteSchema,
  scanRangeSchema,
} from "./schema";
import { DEFAULT_MAX_PHOTOS, MAX_LIST_PHOTOS } from "./types";

// The schemas are the boundary every adapter trusts -- a server action and a CLI
// command both parse with these, so a case accepted here is accepted in both. Worth
// explicit tests for exactly that reason: this is what protects the use-cases from raw
// form data.

describe("photoMagicCriteriaSchema", () => {
  it("accepts an empty criteria set and defaults the ceiling", () => {
    const parsed = photoMagicCriteriaSchema.parse({});
    expect(parsed.maxPhotos).toBe(DEFAULT_MAX_PHOTOS);
    expect(parsed.fromDate).toBeUndefined();
  });

  it("keeps an absent bound absent rather than defaulting it to zero", () => {
    // The absent-bound rule starts here: a `0` filled in for "no minimum" would make
    // `matchesCriteria` apply a bound the reader never asked for.
    const parsed = photoMagicCriteriaSchema.parse({ maxPhotos: 10 });
    expect(parsed.minBytes).toBeUndefined();
    expect(parsed.minWidth).toBeUndefined();
    expect("minBytes" in parsed && parsed.minBytes === 0).toBe(false);
  });

  it("accepts a full criteria set", () => {
    const parsed = photoMagicCriteriaSchema.parse({
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      minBytes: 1024,
      maxBytes: 10 * 1024 * 1024,
      minWidth: 1920,
      minHeight: 1080,
      maxWidth: 8000,
      maxHeight: 8000,
      maxPhotos: 250,
    });
    expect(parsed.minWidth).toBe(1920);
    expect(parsed.maxPhotos).toBe(250);
  });

  it("rejects a malformed date", () => {
    expect(photoMagicCriteriaSchema.safeParse({ fromDate: "09/06/2019" }).success).toBe(false);
    expect(photoMagicCriteriaSchema.safeParse({ fromDate: "2019-6-9" }).success).toBe(false);
  });

  it("rejects a date that does not exist", () => {
    // The regex alone would happily accept this.
    expect(photoMagicCriteriaSchema.safeParse({ fromDate: "2019-02-31" }).success).toBe(false);
  });

  it("accepts a leap day in a leap year and rejects it otherwise", () => {
    expect(photoMagicCriteriaSchema.safeParse({ fromDate: "2020-02-29" }).success).toBe(true);
    expect(photoMagicCriteriaSchema.safeParse({ fromDate: "2019-02-29" }).success).toBe(false);
  });

  it("rejects an inverted date range", () => {
    // A range impossible to satisfy rather than merely empty -- catching it here turns
    // a mystifying "no results" into a message naming the mistake.
    const result = photoMagicCriteriaSchema.safeParse({
      fromDate: "2019-12-31",
      toDate: "2019-01-01",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["toDate"]);
  });

  it("accepts a range whose ends are the same day", () => {
    expect(
      photoMagicCriteriaSchema.safeParse({ fromDate: "2019-06-09", toDate: "2019-06-09" })
        .success,
    ).toBe(true);
  });

  it("rejects an inverted size band", () => {
    const result = photoMagicCriteriaSchema.safeParse({ minBytes: 5000, maxBytes: 1000 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["maxBytes"]);
  });

  it("rejects inverted width and height bands", () => {
    expect(photoMagicCriteriaSchema.safeParse({ minWidth: 4000, maxWidth: 100 }).success).toBe(
      false,
    );
    expect(
      photoMagicCriteriaSchema.safeParse({ minHeight: 4000, maxHeight: 100 }).success,
    ).toBe(false);
  });

  it("rejects a negative size", () => {
    expect(photoMagicCriteriaSchema.safeParse({ minBytes: -1 }).success).toBe(false);
  });

  it("rejects a pixel bound beyond what a JPEG can express", () => {
    // 16-bit frame header, so a bound above 65535 could never be satisfied.
    expect(photoMagicCriteriaSchema.safeParse({ minWidth: 65536 }).success).toBe(false);
    expect(photoMagicCriteriaSchema.safeParse({ minWidth: 65535 }).success).toBe(true);
  });

  it("rejects a zero or negative pixel bound", () => {
    expect(photoMagicCriteriaSchema.safeParse({ minWidth: 0 }).success).toBe(false);
  });

  it("rejects a ceiling below one or above the list maximum", () => {
    expect(photoMagicCriteriaSchema.safeParse({ maxPhotos: 0 }).success).toBe(false);
    expect(photoMagicCriteriaSchema.safeParse({ maxPhotos: MAX_LIST_PHOTOS }).success).toBe(true);
    expect(photoMagicCriteriaSchema.safeParse({ maxPhotos: MAX_LIST_PHOTOS + 1 }).success).toBe(
      false,
    );
  });

  it("rejects a fractional ceiling", () => {
    expect(photoMagicCriteriaSchema.safeParse({ maxPhotos: 10.5 }).success).toBe(false);
  });
});

describe("photoMagicListWriteSchema", () => {
  it("accepts a named list and trims the name", () => {
    const parsed = photoMagicListWriteSchema.parse({
      name: "  Summer 2019  ",
      criteria: {},
    });
    expect(parsed.name).toBe("Summer 2019");
    expect(parsed.description).toBe("");
  });

  it("rejects a blank or whitespace-only name", () => {
    // A list is chosen from a picker by its name, so a blank one is a row nobody can
    // identify.
    expect(photoMagicListWriteSchema.safeParse({ name: "", criteria: {} }).success).toBe(false);
    expect(photoMagicListWriteSchema.safeParse({ name: "   ", criteria: {} }).success).toBe(
      false,
    );
  });

  it("rejects a name past the column's length", () => {
    expect(
      photoMagicListWriteSchema.safeParse({ name: "x".repeat(121), criteria: {} }).success,
    ).toBe(false);
  });

  it("defaults a missing description to blank rather than null", () => {
    // coding-guide.md: a settings value is blank, never NULL.
    expect(photoMagicListWriteSchema.parse({ name: "A", criteria: {} }).description).toBe("");
  });

  it("rejects criteria that fail their own rules", () => {
    const result = photoMagicListWriteSchema.safeParse({
      name: "Bad range",
      criteria: { fromDate: "2019-12-31", toDate: "2019-01-01" },
    });
    expect(result.success).toBe(false);
  });
});

describe("photoMagicListUpdateSchema", () => {
  it("requires a positive id", () => {
    expect(
      photoMagicListUpdateSchema.safeParse({ id: 1, name: "A", criteria: {} }).success,
    ).toBe(true);
    expect(
      photoMagicListUpdateSchema.safeParse({ id: 0, name: "A", criteria: {} }).success,
    ).toBe(false);
    expect(
      photoMagicListUpdateSchema.safeParse({ id: -3, name: "A", criteria: {} }).success,
    ).toBe(false);
  });
});

describe("generatePhotoMagicSchema", () => {
  it("accepts criteria with no list id", () => {
    // "Create the list" works on whatever is in the form, saved or not.
    const parsed = generatePhotoMagicSchema.parse({ criteria: {} });
    expect(parsed.listId).toBeUndefined();
  });

  it("accepts a list id alongside criteria", () => {
    expect(generatePhotoMagicSchema.parse({ listId: 7, criteria: {} }).listId).toBe(7);
  });

  it("rejects a non-positive list id", () => {
    expect(generatePhotoMagicSchema.safeParse({ listId: 0, criteria: {} }).success).toBe(false);
  });
});

describe("scanRangeSchema", () => {
  it("accepts an absent range, meaning the whole archive", () => {
    const parsed = scanRangeSchema.parse({});
    expect(parsed.fromDate).toBeUndefined();
    expect(parsed.toDate).toBeUndefined();
  });

  it("accepts a valid range", () => {
    expect(scanRangeSchema.safeParse({ fromDate: "2019-01-01", toDate: "2019-12-31" }).success).toBe(
      true,
    );
  });

  it("rejects an inverted range", () => {
    expect(scanRangeSchema.safeParse({ fromDate: "2020-01-01", toDate: "2019-01-01" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed date", () => {
    expect(scanRangeSchema.safeParse({ fromDate: "yesterday" }).success).toBe(false);
  });
});
