import { describe, expect, it } from "vitest";
import {
  cleanSearchTerm,
  deriveLyricsQuery,
  isDurationMatch,
  shouldRefetchLyrics,
  shouldSendDuration,
  type TrackLyrics,
} from "./lyrics";
import type { Track } from "./types";

// The filenames here are real ones from the library this module was built against,
// because the whole point of cleanSearchTerm is coping with how they are actually
// written rather than how they ought to be.

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    relativePath: "ENGLISH/A/x.mp3",
    fileName: "x.mp3",
    title: "",
    displayTitle: "x.mp3",
    artist: "",
    album: "",
    albumArtist: "",
    genre: "",
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1,
    fileMtime: "2026-01-01T00:00:00Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
    ...overrides,
  };
}

describe("cleanSearchTerm", () => {
  it("drops a trailing parenthetical", () => {
    expect(cleanSearchTerm("Amani (Live)")).toBe("Amani");
    expect(cleanSearchTerm("Before It Breaks (Live At Benaroya Hall)")).toBe("Before It Breaks");
    expect(cleanSearchTerm("APT (ROSE & Bruno Mars)")).toBe("APT");
  });

  it("drops a trailing bracketed group too", () => {
    expect(cleanSearchTerm("Amani [Remastered]")).toBe("Amani");
  });

  it("drops several trailing groups", () => {
    expect(cleanSearchTerm("Song (Live) (Remastered 2011)")).toBe("Song");
  });

  it("strips a leading track number in the forms that appear here", () => {
    expect(cleanSearchTerm("01 Amani")).toBe("Amani");
    expect(cleanSearchTerm("01. Amani")).toBe("Amani");
    expect(cleanSearchTerm("01 - Amani")).toBe("Amani");
    expect(cleanSearchTerm("003 Amani")).toBe("Amani");
  });

  it("leaves a bare title alone", () => {
    expect(cleanSearchTerm("Amani")).toBe("Amani");
    expect(cleanSearchTerm("  Amani  ")).toBe("Amani");
  });

  it("keeps non-ASCII titles intact", () => {
    expect(cleanSearchTerm("光辉岁月")).toBe("光辉岁月");
    expect(cleanSearchTerm("光辉岁月 (Live)")).toBe("光辉岁月");
  });

  it("does not reduce a title to nothing", () => {
    // Stripping here would leave an empty query, which cannot be searched.
    expect(cleanSearchTerm("(Instrumental)")).toBe("(Instrumental)");
    expect(cleanSearchTerm("")).toBe("");
  });

  it("keeps an interior parenthetical, which is often part of the name", () => {
    expect(cleanSearchTerm("Song (Part 1) Continued")).toBe("Song (Part 1) Continued");
  });
});

describe("deriveLyricsQuery", () => {
  it("prefers the tags when both are present", () => {
    const query = deriveLyricsQuery(
      track({ artist: "Beyond", title: "AMANI", album: "Live", durationSeconds: 290 }),
    );
    expect(query).toEqual({
      artist: "Beyond",
      title: "AMANI",
      durationSeconds: 290,
      album: "Live",
    });
  });

  it("cleans the tagged values", () => {
    const query = deriveLyricsQuery(track({ artist: "Beyond", title: "01 AMANI (Live)" }));
    expect(query?.title).toBe("AMANI");
  });

  it("falls back to an 'Artist - Title' filename when tags are missing", () => {
    const query = deriveLyricsQuery(
      track({ fileName: "Aaron Neville & Linda Ronstadt - Don't Know Much.ape" }),
    );
    expect(query?.artist).toBe("Aaron Neville & Linda Ronstadt");
    expect(query?.title).toBe("Don't Know Much");
  });

  it("handles a filename whose title itself contains a dash", () => {
    const query = deriveLyricsQuery(track({ fileName: "Beyond - Song - Reprise.mp3" }));
    expect(query?.artist).toBe("Beyond");
    expect(query?.title).toBe("Song - Reprise");
  });

  it("strips a trailing parenthetical from a filename fallback", () => {
    const query = deriveLyricsQuery(
      track({ fileName: "Brandi Carlile - Before It Breaks (Live At Benaroya Hall).mp3" }),
    );
    expect(query?.artist).toBe("Brandi Carlile");
    expect(query?.title).toBe("Before It Breaks");
  });

  it("searches on title alone when there is no artist anywhere", () => {
    const query = deriveLyricsQuery(track({ title: "AMANI" }));
    expect(query).toEqual({ artist: "", title: "AMANI", durationSeconds: undefined });
  });

  it("uses the filename as a title when nothing else is available", () => {
    const query = deriveLyricsQuery(track({ fileName: "AMANI.flac" }));
    expect(query?.title).toBe("AMANI");
  });

  it("returns undefined when there is nothing searchable", () => {
    // No tags, and a filename that cleans away to nothing.
    expect(deriveLyricsQuery(track({ fileName: ".mp3", title: "", artist: "" }))).toBeUndefined();
  });

  it("omits a blank album rather than sending an empty one", () => {
    const query = deriveLyricsQuery(track({ artist: "Beyond", title: "AMANI", album: "" }));
    expect(query?.album).toBeUndefined();
  });
});

describe("shouldRefetchLyrics", () => {
  function cached(status: TrackLyrics["status"]): TrackLyrics {
    return {
      trackId: 1,
      status,
      lyrics: status === "found" ? "words" : "",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-18 00:00:00",
    };
  }

  it("fetches when nothing is cached", () => {
    expect(shouldRefetchLyrics(undefined)).toBe(true);
  });

  it("does not refetch a hit", () => {
    expect(shouldRefetchLyrics(cached("found"))).toBe(false);
  });

  it("never refetches an instrumental, which is a real answer", () => {
    // Retrying this would re-request the same track forever.
    expect(shouldRefetchLyrics(cached("instrumental"))).toBe(false);
  });

  it("retries a miss, since LRCLIB's database grows", () => {
    expect(shouldRefetchLyrics(cached("not_found"))).toBe(true);
  });

  it("retries a failure, so an offline NAS is not remembered as 'no lyrics'", () => {
    expect(shouldRefetchLyrics(cached("failed"))).toBe(true);
  });
});

describe("shouldSendDuration", () => {
  it("sends a plausible duration", () => {
    expect(shouldSendDuration(290)).toBe(true);
  });

  it("withholds a missing or nonsense duration, which would force a 404", () => {
    // The API matches duration strictly, so a wrong value turns a hit into a miss.
    expect(shouldSendDuration(undefined)).toBe(false);
    expect(shouldSendDuration(0)).toBe(false);
    expect(shouldSendDuration(-5)).toBe(false);
    expect(shouldSendDuration(Number.NaN)).toBe(false);
    expect(shouldSendDuration(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isDurationMatch", () => {
  it("accepts a small difference between masterings", () => {
    expect(isDurationMatch(290, 289)).toBe(true);
    expect(isDurationMatch(290, 292)).toBe(true);
  });

  it("rejects a clearly different recording", () => {
    expect(isDurationMatch(290, 180)).toBe(false);
  });

  it("cannot judge when either side is unknown, so it accepts", () => {
    expect(isDurationMatch(undefined, 289)).toBe(true);
    expect(isDurationMatch(290, undefined)).toBe(true);
  });
});
