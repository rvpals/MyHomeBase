import { describe, expect, it } from "vitest";
import {
  deriveStoryQuery,
  slugifySongfacts,
  songfactsCandidates,
  songfactsSearchUrl,
  songfactsUrl,
} from "./story";
import type { Track } from "./types";

// The slug rules are asserted against URLs that were confirmed to return HTTP 200 on
// songfacts.com, not against what seemed reasonable. That distinction is the point of
// these tests: the slug IS the API here, so a rule that looks sensible but does not
// match the real site is a silent total failure of the feature.

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    relativePath: "Billy Joel/52nd Street/03 Honesty.mp3",
    fileName: "03 Honesty.mp3",
    title: "Honesty",
    displayTitle: "Honesty",
    artist: "Billy Joel",
    album: "52nd Street",
    albumArtist: "Billy Joel",
    genre: "Rock",
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01 00:00:00",
    isStreamable: true,
    hasCueSheet: false,
    ...overrides,
  } as Track;
}

describe("slugifySongfacts", () => {
  it("lowercases and hyphenates, matching a real Songfacts path", () => {
    expect(slugifySongfacts("Billy Joel")).toBe("billy-joel");
    expect(slugifySongfacts("While My Guitar Gently Weeps")).toBe(
      "while-my-guitar-gently-weeps",
    );
  });

  it("folds accents rather than dropping the letter", () => {
    // /facts/beyonce/halo is a real page; "beyonc" would 404.
    expect(slugifySongfacts("Beyoncé")).toBe("beyonce");
  });

  it("closes up apostrophes instead of turning them into hyphens", () => {
    // /facts/guns-n-roses/dont-cry is real; "don-t-cry" is not.
    expect(slugifySongfacts("Don't Cry")).toBe("dont-cry");
    expect(slugifySongfacts("Guns N' Roses")).toBe("guns-n-roses");
    // Curly apostrophes arrive from tags too and must behave identically.
    expect(slugifySongfacts("Don’t Cry")).toBe("dont-cry");
  });

  it("turns punctuation runs into a single hyphen and trims the ends", () => {
    expect(slugifySongfacts("AC/DC")).toBe("ac-dc");
    expect(slugifySongfacts("  Hello... World!  ")).toBe("hello-world");
  });

  it("spells out an ampersand, the way the site does", () => {
    expect(slugifySongfacts("Simon & Garfunkel")).toBe("simon-and-garfunkel");
  });

  it("returns '' for something with no sluggable characters", () => {
    expect(slugifySongfacts("!!!")).toBe("");
    expect(slugifySongfacts("")).toBe("");
  });
});

describe("songfactsUrl", () => {
  it("builds the /facts/<artist>/<title> path", () => {
    expect(songfactsUrl("billy-joel", "honesty")).toBe(
      "https://www.songfacts.com/facts/billy-joel/honesty",
    );
  });
});

describe("deriveStoryQuery", () => {
  it("uses the tags when both are present", () => {
    expect(deriveStoryQuery(track())).toEqual({ artist: "Billy Joel", title: "Honesty" });
  });

  it("strips the decoration a filename-derived title carries", () => {
    const derived = deriveStoryQuery(track({ title: "01 Amani (Live At Benaroya Hall)" }));
    expect(derived).toEqual({ artist: "Billy Joel", title: "Amani" });
  });

  it("falls back to an 'Artist - Title' filename when tags are empty", () => {
    const derived = deriveStoryQuery(
      track({ artist: "", title: "", fileName: "Brandi Carlile - Before It Breaks.mp3" }),
    );
    expect(derived).toEqual({ artist: "Brandi Carlile", title: "Before It Breaks" });
  });

  it("gives up when there is no artist to build a URL with", () => {
    // The failure path that matters: Songfacts is addressed by artist AND title, and
    // their robots.txt rules out searching by title alone.
    expect(deriveStoryQuery(track({ artist: "", fileName: "Honesty.mp3" }))).toBeUndefined();
  });
});

describe("songfactsCandidates", () => {
  it("puts the plain slug first", () => {
    const candidates = songfactsCandidates({ artist: "Billy Joel", title: "Honesty" });
    expect(candidates[0]).toBe("https://www.songfacts.com/facts/billy-joel/honesty");
  });

  it("tries the artist without a leading 'the-', which tags disagree about", () => {
    const candidates = songfactsCandidates({ artist: "The Beatles", title: "Help" });
    expect(candidates).toContain("https://www.songfacts.com/facts/the-beatles/help");
    expect(candidates).toContain("https://www.songfacts.com/facts/beatles/help");
  });

  it("tries adding 'the-' when the tag omits it", () => {
    const candidates = songfactsCandidates({ artist: "Beatles", title: "Help" });
    expect(candidates).toContain("https://www.songfacts.com/facts/the-beatles/help");
  });

  it("offers the title without its subtitle", () => {
    const candidates = songfactsCandidates({
      artist: "Prince",
      title: "Purple Rain: Extended",
    });
    expect(candidates).toContain("https://www.songfacts.com/facts/prince/purple-rain");
  });

  it("never repeats a URL", () => {
    const candidates = songfactsCandidates({ artist: "Billy Joel", title: "Honesty" });
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("returns nothing when either half cannot be slugged", () => {
    expect(songfactsCandidates({ artist: "", title: "Honesty" })).toEqual([]);
    expect(songfactsCandidates({ artist: "!!!", title: "Honesty" })).toEqual([]);
  });
});

describe("songfactsSearchUrl", () => {
  it("encodes the artist and title into a search the listener can open", () => {
    expect(songfactsSearchUrl({ artist: "Billy Joel", title: "Honesty" })).toBe(
      "https://www.songfacts.com/search/songs/Billy%20Joel%20Honesty",
    );
  });
});
