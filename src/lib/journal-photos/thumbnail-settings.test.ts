import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESIZE_ORIGINALS,
  PHOTO_THUMBNAIL_SETTING_KEYS,
  photoThumbnailResizeValue,
  resolvePhotoThumbnailSettings,
} from "./thumbnail-settings";

const KEY = PHOTO_THUMBNAIL_SETTING_KEYS.resizeOriginals;

describe("resolvePhotoThumbnailSettings", () => {
  it("reads an explicit true", () => {
    expect(resolvePhotoThumbnailSettings([{ key: KEY, value: "true" }])).toEqual({
      resizeOriginals: true,
    });
  });

  it("reads an explicit false -- the only value that turns it off", () => {
    expect(resolvePhotoThumbnailSettings([{ key: KEY, value: "false" }])).toEqual({
      resizeOriginals: false,
    });
  });

  it("tolerates surrounding space and capitals, as a hand-edited row may carry", () => {
    expect(resolvePhotoThumbnailSettings([{ key: KEY, value: "  FALSE " }]).resizeOriginals).toBe(
      false,
    );
    expect(resolvePhotoThumbnailSettings([{ key: KEY, value: " True " }]).resizeOriginals).toBe(
      true,
    );
  });

  it("defaults to on when the row is missing", () => {
    expect(resolvePhotoThumbnailSettings([]).resizeOriginals).toBe(DEFAULT_RESIZE_ORIGINALS);
    expect(DEFAULT_RESIZE_ORIGINALS).toBe(true);
  });

  it("defaults to on for a blank or unparseable value, rather than disabling the feature", () => {
    for (const value of ["", "   ", "yes", "no", "0", "1", "off"]) {
      expect(resolvePhotoThumbnailSettings([{ key: KEY, value }]).resizeOriginals, value).toBe(true);
    }
  });

  it("ignores rows for other keys", () => {
    const rows = [
      { key: "system_log_debug", value: "false" },
      { key: "backup_enabled", value: "false" },
    ];
    expect(resolvePhotoThumbnailSettings(rows).resizeOriginals).toBe(true);
  });

  it("reads the switch out of a full settings table", () => {
    const rows = [
      { key: "application_name", value: "MyHomeBase" },
      { key: KEY, value: "false" },
      { key: "system_log_max_rows", value: "5000" },
    ];
    expect(resolvePhotoThumbnailSettings(rows).resizeOriginals).toBe(false);
  });
});

describe("photoThumbnailResizeValue", () => {
  it("writes what the resolver reads, in both directions", () => {
    for (const enabled of [true, false]) {
      const value = photoThumbnailResizeValue(enabled);
      expect(resolvePhotoThumbnailSettings([{ key: KEY, value }]).resizeOriginals, value).toBe(
        enabled,
      );
    }
  });

  it("spells the value out, as the other app settings do", () => {
    expect(photoThumbnailResizeValue(true)).toBe("true");
    expect(photoThumbnailResizeValue(false)).toBe("false");
  });
});
