import { describe, expect, it } from "vitest";
import {
  buildSearchTerm,
  embedUrl,
  isDurationPlausible,
  parseDurationBadge,
  pickBestCandidate,
  rankCandidates,
  scoreCandidate,
  titleNamesSong,
  watchUrl,
  youtubeSearchUrl,
} from "./youtube";
import type { VideoCandidate, VideoQuery } from "./types";

const HONESTY: VideoQuery = { artist: "Billy Joel", title: "Honesty", durationSeconds: 227 };

function candidate(overrides: Partial<VideoCandidate>): VideoCandidate {
  return {
    videoId: "abc12345678",
    title: "Billy Joel - Honesty",
    channel: "Billy Joel",
    durationSeconds: 227,
    ...overrides,
  };
}

describe("buildSearchTerm", () => {
  it("joins artist and title the way a person would type them", () => {
    expect(buildSearchTerm(HONESTY)).toBe("Billy Joel Honesty");
  });

  it("drops a missing half rather than leaving a stray space", () => {
    expect(buildSearchTerm({ artist: "", title: "Honesty" })).toBe("Honesty");
    expect(buildSearchTerm({ artist: "Billy Joel", title: "" })).toBe("Billy Joel");
  });

  it("is empty when there is nothing to search for", () => {
    expect(buildSearchTerm({ artist: "  ", title: "" })).toBe("");
  });
});

describe("urls", () => {
  it("builds a search url with the term encoded", () => {
    expect(youtubeSearchUrl(HONESTY)).toBe(
      "https://www.youtube.com/results?search_query=Billy%20Joel%20Honesty",
    );
  });

  it("builds a watch url", () => {
    expect(watchUrl("SuFScoO4tb0")).toBe("https://www.youtube.com/watch?v=SuFScoO4tb0");
  });

  it("embeds through the no-cookie host", () => {
    expect(embedUrl("SuFScoO4tb0")).toBe(
      "https://www.youtube-nocookie.com/embed/SuFScoO4tb0?rel=0",
    );
  });
});

describe("parseDurationBadge", () => {
  it("reads mm:ss", () => {
    expect(parseDurationBadge("3:47")).toBe(227);
  });

  it("reads h:mm:ss", () => {
    expect(parseDurationBadge("1:02:33")).toBe(3753);
    expect(parseDurationBadge("10:00:00")).toBe(36000);
  });

  it("returns undefined for a live badge, which is not a length", () => {
    expect(parseDurationBadge("LIVE")).toBeUndefined();
    expect(parseDurationBadge("Premiere")).toBeUndefined();
  });

  it("returns undefined for an absent or malformed badge", () => {
    expect(parseDurationBadge(undefined)).toBeUndefined();
    expect(parseDurationBadge("")).toBeUndefined();
    expect(parseDurationBadge("3:4a")).toBeUndefined();
    expect(parseDurationBadge("1:2:3:4")).toBeUndefined();
  });
});

describe("isDurationPlausible", () => {
  it("accepts a close match", () => {
    expect(isDurationPlausible(227, 227)).toBe(true);
    expect(isDurationPlausible(236, 227)).toBe(true);
  });

  it("rejects a ten-hour loop of a four-minute song", () => {
    expect(isDurationPlausible(36000, 227)).toBe(false);
  });

  it("has no opinion when either side is unknown", () => {
    expect(isDurationPlausible(undefined, 227)).toBe(true);
    expect(isDurationPlausible(227, undefined)).toBe(true);
    expect(isDurationPlausible(0, 227)).toBe(true);
  });
});

describe("titleNamesSong", () => {
  it("accepts the song title as a phrase inside a noisy YouTube title", () => {
    expect(
      titleNamesSong(
        candidate({ title: "Billy Joel - Honesty (Official Video) [HD Remaster]" }),
        HONESTY,
      ),
    ).toBe(true);
  });

  it("accepts a title whose significant words are all present but reordered", () => {
    expect(
      titleNamesSong(candidate({ title: "Bohemian Rhapsody (Queen) - remastered" }), {
        artist: "Queen",
        title: "Rhapsody Bohemian",
      }),
    ).toBe(true);
  });

  it("folds accents, so a tag without them still matches", () => {
    expect(
      titleNamesSong(candidate({ title: "Beyoncé - Halo" }), {
        artist: "Beyonce",
        title: "Halo",
      }),
    ).toBe(true);
  });

  it("rejects an unrelated video, which is the whole point of the gate", () => {
    // The real false positive this gate was added for: a search for a song that does
    // not exist returned a random upload of roughly the right length.
    expect(
      titleNamesSong(
        candidate({ title: "MeAshraf70 Boy Band Dreams #music #songs #song" }),
        { artist: "Nonexistent Zzq Band", title: "Fake Song Qqx", durationSeconds: 200 },
      ),
    ).toBe(false);
  });

  it("ignores short words, so a one-word title cannot match on a substring", () => {
    expect(titleNamesSong(candidate({ title: "Going Under" }), { artist: "X", title: "Go" })).toBe(
      false,
    );
  });

  it("rejects an empty title outright", () => {
    expect(titleNamesSong(candidate({}), { artist: "Billy Joel", title: "" })).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("hard-rejects a candidate whose title is not about the song, whatever else it has", () => {
    // Duration and channel are corroborating evidence, never identifying evidence: a
    // three-minute video from a plausible channel is still not this song.
    const unrelated = candidate({
      title: "MeAshraf70 Boy Band Dreams",
      channel: "billyjoelVEVO",
      durationSeconds: 227,
    });
    expect(scoreCandidate(unrelated, HONESTY)).toBe(-1);
    expect(rankCandidates([unrelated], HONESTY)).toEqual([]);
  });

  it("puts a bare but plausible match exactly at the floor", () => {
    // Right title, unknown channel, no duration to compare -- worth offering, but only
    // just.
    const bare = candidate({ title: "Honesty", channel: "some uploader", durationSeconds: undefined });
    expect(scoreCandidate(bare, { artist: "Billy Joel", title: "Honesty" })).toBe(1);
  });

  it("rewards an official channel and a matching length", () => {
    const official = candidate({ channel: "billyjoelVEVO", title: "Billy Joel - Honesty" });
    // +3 channel, +2 duration, +1 title
    expect(scoreCandidate(official, HONESTY)).toBe(6);
  });

  it("sinks a karaoke upload below the floor even from a plausible channel", () => {
    const karaoke = candidate({
      title: "Honesty - Billy Joel | Karaoke Version",
      channel: "Sing King Karaoke",
      durationSeconds: 232,
    });
    expect(scoreCandidate(karaoke, HONESTY)).toBeLessThan(1);
  });

  it("sinks a ten-hour loop", () => {
    const loop = candidate({
      title: "Billy Joel - Honesty [10 hours]",
      channel: "Relax Loops",
      durationSeconds: 36000,
    });
    expect(scoreCandidate(loop, HONESTY)).toBeLessThan(1);
  });

  it("treats a live version as second best, not as wrong", () => {
    const live = candidate({ title: "Billy Joel - Honesty (Live in Tokyo)", channel: "In Concert" });
    const studio = candidate({ title: "Billy Joel - Honesty", channel: "In Concert" });
    expect(scoreCandidate(live, HONESTY)).toBeLessThan(scoreCandidate(studio, HONESTY));
    expect(scoreCandidate(live, HONESTY)).toBeGreaterThan(-4);
  });

  it("does not penalise a keyword the listener asked for", () => {
    const liveQuery: VideoQuery = { artist: "Billy Joel", title: "Honesty (Live)", durationSeconds: 241 };
    const live = candidate({ title: "Billy Joel - Honesty (Live)", durationSeconds: 241 });
    // The 'live' penalty must not apply when the query itself says live.
    expect(scoreCandidate(live, liveQuery)).toBeGreaterThanOrEqual(5);
  });

  it("credits a channel that names the artist without a partner suffix", () => {
    const own = candidate({ channel: "Billy Joel" });
    expect(scoreCandidate(own, HONESTY)).toBe(6);
  });
});

describe("rankCandidates", () => {
  const results = [
    candidate({ videoId: "lyrics00001", title: "Billy Joel - Honesty (Lyrics)", channel: "7clouds Rock", durationSeconds: 229 }),
    candidate({ videoId: "official001", title: "Billy Joel - Honesty (Official Video)", channel: "billyjoelVEVO", durationSeconds: 227 }),
    candidate({ videoId: "karaoke0001", title: "Honesty (Karaoke)", channel: "Sing King", durationSeconds: 232 }),
  ];

  it("puts the official upload first even when a re-upload ranked higher on YouTube", () => {
    expect(rankCandidates(results, HONESTY).map((entry) => entry.videoId)).toEqual([
      "official001",
      "lyrics00001",
    ]);
  });

  it("drops candidates below the score floor", () => {
    expect(rankCandidates(results, HONESTY).some((entry) => entry.videoId === "karaoke0001")).toBe(
      false,
    );
  });

  it("drops a video that cannot be embedded", () => {
    const blocked = [candidate({ videoId: "blocked0001", channel: "billyjoelVEVO", playableInEmbed: false })];
    expect(rankCandidates(blocked, HONESTY)).toEqual([]);
  });

  it("keeps a video whose embeddability is unknown", () => {
    const unknown = [candidate({ channel: "billyjoelVEVO", playableInEmbed: undefined })];
    expect(rankCandidates(unknown, HONESTY)).toHaveLength(1);
  });

  it("preserves YouTube's order between equally scored candidates", () => {
    const tied = [
      candidate({ videoId: "first000001", channel: "Billy Joel" }),
      candidate({ videoId: "second00001", channel: "Billy Joel" }),
    ];
    expect(rankCandidates(tied, HONESTY).map((entry) => entry.videoId)).toEqual([
      "first000001",
      "second00001",
    ]);
  });

  it("returns nothing for an empty search", () => {
    expect(rankCandidates([], HONESTY)).toEqual([]);
  });

  it("ignores a candidate with no id", () => {
    expect(rankCandidates([candidate({ videoId: "" })], HONESTY)).toEqual([]);
  });
});

describe("pickBestCandidate", () => {
  it("returns the top-ranked video", () => {
    const best = pickBestCandidate(
      [
        candidate({ videoId: "lyrics00001", title: "Honesty (Lyrics)", channel: "7clouds" }),
        candidate({ videoId: "official001", channel: "billyjoelVEVO" }),
      ],
      HONESTY,
    );
    expect(best?.videoId).toBe("official001");
  });

  it("returns undefined when nothing is good enough", () => {
    const junk = [candidate({ title: "Honesty Karaoke", channel: "Sing King", durationSeconds: 36000 })];
    expect(pickBestCandidate(junk, HONESTY)).toBeUndefined();
  });
});
