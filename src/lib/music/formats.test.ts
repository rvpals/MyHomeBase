import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_EXTENSIONS,
  extensionOf,
  formatOf,
  isMusicExtension,
  MUSIC_EXTENSIONS,
  MUSIC_FORMATS,
  STREAMABLE_EXTENSIONS,
} from "./formats";

describe("extensionOf", () => {
  it("lowercases and drops the dot", () => {
    expect(extensionOf("AMANI.FLAC")).toBe("flac");
    expect(extensionOf("song.Mp3")).toBe("mp3");
  });

  it("takes only the last dot", () => {
    expect(extensionOf("song.remastered.flac")).toBe("flac");
  });

  it("handles both separators and full paths", () => {
    expect(extensionOf("CHINESE/Beyond/AMANI.flac")).toBe("flac");
    expect(extensionOf(String.raw`CHINESE\Beyond\AMANI.flac`)).toBe("flac");
  });

  it("returns '' when there is no extension", () => {
    expect(extensionOf("Cover")).toBe("");
    expect(extensionOf("CHINESE/Beyond")).toBe("");
  });

  it("does not treat a dotfile's leading dot as an extension", () => {
    expect(extensionOf(".hidden")).toBe("");
  });
});

describe("the format table", () => {
  it("has an entry for every listed extension", () => {
    for (const extension of MUSIC_EXTENSIONS) {
      expect(MUSIC_FORMATS[extension]).toBeDefined();
      expect(MUSIC_FORMATS[extension].extension).toBe(extension);
      expect(MUSIC_FORMATS[extension].mimeType).not.toBe("");
    }
  });

  it("marks ape and wma unplayable, because no browser decodes them", () => {
    // The whole "catalog it but grey out play" behaviour hangs off these two.
    expect(MUSIC_FORMATS.ape.isStreamable).toBe(false);
    expect(MUSIC_FORMATS.wma.isStreamable).toBe(false);
  });

  it("marks the formats browsers do decode as streamable", () => {
    expect(MUSIC_FORMATS.mp3.isStreamable).toBe(true);
    expect(MUSIC_FORMATS.flac.isStreamable).toBe(true);
    expect(MUSIC_FORMATS.ogg.isStreamable).toBe(true);
    expect(MUSIC_FORMATS.m4a.isStreamable).toBe(true);
  });

  it("excludes the unplayable formats from STREAMABLE_EXTENSIONS", () => {
    expect(STREAMABLE_EXTENSIONS).not.toContain("ape");
    expect(STREAMABLE_EXTENSIONS).not.toContain("wma");
    expect(STREAMABLE_EXTENSIONS).toContain("mp3");
  });

  it("defaults a fresh install to the two formats that are 95% of this library", () => {
    expect(DEFAULT_SCAN_EXTENSIONS).toEqual(["mp3", "flac"]);
  });
});

describe("isMusicExtension", () => {
  it("accepts a known extension in any case", () => {
    expect(isMusicExtension("flac")).toBe(true);
    expect(isMusicExtension("FLAC")).toBe(true);
  });

  it("rejects anything else, including sibling files a scan will meet", () => {
    expect(isMusicExtension("cue")).toBe(false);
    expect(isMusicExtension("webp")).toBe(false);
    expect(isMusicExtension("")).toBe(false);
    // Not inherited from Object.prototype.
    expect(isMusicExtension("toString")).toBe(false);
  });
});

describe("formatOf", () => {
  it("resolves a path to its format", () => {
    expect(formatOf("CHINESE/Beyond/AMANI.flac")?.mimeType).toBe("audio/flac");
    expect(formatOf("x.mp3")?.mimeType).toBe("audio/mpeg");
  });

  it("returns undefined for a non-audio sibling", () => {
    expect(formatOf("CHINESE/Beyond/Cover.webp")).toBeUndefined();
    expect(formatOf("album.cue")).toBeUndefined();
  });
});
