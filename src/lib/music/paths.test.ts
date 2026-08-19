import { describe, expect, it } from "vitest";
import {
  isSafeRelativePath,
  normaliseRelativePath,
  parentFolderOf,
  resolveTrackPath,
  toRelativePath,
} from "./paths";

// This file is the guard between a database value and an arbitrary file read, so
// the rejection cases matter more than the happy path.

const POSIX_ROOT = "/volume1/MEDIA/AUDIO";
const UNC_ROOT = "//NAS_DS223/MEDIA/AUDIO";

describe("normaliseRelativePath", () => {
  it("converts backslashes and strips empty and dot segments", () => {
    expect(normaliseRelativePath(String.raw`CHINESE\Beyond\AMANI.flac`)).toBe("CHINESE/Beyond/AMANI.flac");
    expect(normaliseRelativePath("/CHINESE//Beyond/./AMANI.flac/")).toBe(
      "CHINESE/Beyond/AMANI.flac",
    );
  });

  it("leaves .. in place rather than resolving it", () => {
    // Resolving here would turn a traversal attempt into a valid-looking path;
    // isSafeRelativePath is what must reject it.
    expect(normaliseRelativePath("a/../b")).toBe("a/../b");
  });
});

describe("isSafeRelativePath", () => {
  it("accepts an ordinary relative path", () => {
    expect(isSafeRelativePath("CHINESE/Beyond/AMANI.flac")).toBe(true);
    expect(isSafeRelativePath("ENGLISH/A/Angel Toes (Kristen Hall).mp3")).toBe(true);
  });

  it("accepts non-ASCII names, which this library is full of", () => {
    expect(isSafeRelativePath("CHINESE/凤凰传奇/光辉岁月.flac")).toBe(true);
  });

  it("rejects traversal in any position", () => {
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("CHINESE/../../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("CHINESE/Beyond/..")).toBe(false);
    expect(isSafeRelativePath(String.raw`..\..\windows\system32`)).toBe(false);
  });

  it("rejects absolute, drive-letter and UNC paths", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:/Windows/System32/config/SAM")).toBe(false);
    expect(isSafeRelativePath(String.raw`c:\windows`)).toBe(false);
    // A UNC path normalises to a leading slash, so it is caught too.
    expect(isSafeRelativePath("//other-server/share/file.mp3")).toBe(false);
  });

  it("rejects a NUL byte, which can truncate a native path", () => {
    expect(isSafeRelativePath("song.mp3\0.txt")).toBe(false);
  });

  it("rejects blank input", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("   ")).toBe(false);
  });

  it("does not treat a leading dot in a filename as traversal", () => {
    expect(isSafeRelativePath("CHINESE/.hidden.mp3")).toBe(true);
    // A file literally named ".." is the traversal case, not a dotfile.
    expect(isSafeRelativePath("CHINESE/...mp3")).toBe(true);
  });
});

describe("resolveTrackPath", () => {
  it("joins onto a POSIX root", () => {
    expect(resolveTrackPath(POSIX_ROOT, "CHINESE/Beyond/AMANI.flac")).toBe(
      "/volume1/MEDIA/AUDIO/CHINESE/Beyond/AMANI.flac",
    );
  });

  it("joins onto a UNC root, so the dev machine works too", () => {
    expect(resolveTrackPath(UNC_ROOT, "CHINESE/Beyond/AMANI.flac")).toBe(
      "//NAS_DS223/MEDIA/AUDIO/CHINESE/Beyond/AMANI.flac",
    );
  });

  it("tolerates a trailing slash on the root", () => {
    expect(resolveTrackPath(`${POSIX_ROOT}/`, "a.mp3")).toBe("/volume1/MEDIA/AUDIO/a.mp3");
  });

  it("returns undefined for every unsafe path rather than throwing", () => {
    // undefined is a 404 to the listener; a throw would be a 500.
    expect(resolveTrackPath(POSIX_ROOT, "../../etc/passwd")).toBeUndefined();
    expect(resolveTrackPath(POSIX_ROOT, "/etc/passwd")).toBeUndefined();
    expect(resolveTrackPath(POSIX_ROOT, "C:/Windows")).toBeUndefined();
    expect(resolveTrackPath(POSIX_ROOT, "")).toBeUndefined();
  });

  it("returns undefined when the root is not configured", () => {
    expect(resolveTrackPath("", "a.mp3")).toBeUndefined();
  });
});

describe("toRelativePath", () => {
  it("strips the root from a walked absolute path", () => {
    expect(toRelativePath(POSIX_ROOT, "/volume1/MEDIA/AUDIO/CHINESE/Beyond/AMANI.flac")).toBe(
      "CHINESE/Beyond/AMANI.flac",
    );
  });

  it("handles Windows separators from an SMB walk", () => {
    expect(toRelativePath(UNC_ROOT, String.raw`\\NAS_DS223\MEDIA\AUDIO\ENGLISH\A\x.mp3`)).toBe(
      "ENGLISH/A/x.mp3",
    );
  });

  it("compares case-insensitively, since SMB and ext4 disagree on case", () => {
    expect(toRelativePath(POSIX_ROOT, "/VOLUME1/media/audio/x.mp3")).toBe("x.mp3");
  });

  it("returns '' for the root itself", () => {
    expect(toRelativePath(POSIX_ROOT, POSIX_ROOT)).toBe("");
  });

  it("returns undefined for a path outside the root", () => {
    expect(toRelativePath(POSIX_ROOT, "/volume1/MEDIA/VIDEO/x.mkv")).toBeUndefined();
    // A sibling folder whose name merely starts with the root's name.
    expect(toRelativePath(POSIX_ROOT, "/volume1/MEDIA/AUDIOBOOKS/x.mp3")).toBeUndefined();
  });
});

describe("parentFolderOf", () => {
  it("gives the containing folder", () => {
    expect(parentFolderOf("CHINESE/Beyond/AMANI.flac")).toBe("CHINESE/Beyond");
  });

  it("gives '' for a file at the root", () => {
    expect(parentFolderOf("AMANI.flac")).toBe("");
  });
});
