import { describe, expect, it } from "vitest";
import type { TickerNewsClient } from "./ports";
import { getTopStory, isPrimarySubject, pickTopStory } from "./ticker-news";
import type { RawNewsStory } from "./types";

const TODAY = "2026-08-04";

/** An instant on `date` at the given local hour, as the provider would report it. */
function at(date: string, hour: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour).toISOString();
}

function makeStory(overrides: Partial<RawNewsStory> = {}): RawNewsStory {
  return {
    title: "Nvidia beats on earnings",
    publisher: "Reuters",
    url: "https://example.com/a",
    publishedAt: at(TODAY, 9),
    relatedTickers: ["NVDA"],
    ...overrides,
  };
}

function fakeClient(stories: RawNewsStory[] | Error): TickerNewsClient {
  return {
    async searchStories() {
      if (stories instanceof Error) throw stories;
      return stories;
    },
  };
}

describe("isPrimarySubject", () => {
  it("is true when the provider lists the ticker first", () => {
    expect(isPrimarySubject(makeStory({ relatedTickers: ["NVDA", "AMD"] }), "NVDA")).toBe(true);
  });

  it("is true when the headline names the ticker, even if listed later", () => {
    expect(
      isPrimarySubject(
        makeStory({ title: "Why NVDA jumped today", relatedTickers: ["AMD", "NVDA"] }),
        "NVDA",
      ),
    ).toBe(true);
  });

  it("is false when the ticker is only a trailing tag", () => {
    expect(
      isPrimarySubject(
        makeStory({ title: "AMD Stock Tumbles Overnight", relatedTickers: ["AMD", "SPCX", "NVDA"] }),
        "NVDA",
      ),
    ).toBe(false);
  });

  it("matches on a word boundary, so a short ticker isn't found inside a longer word", () => {
    // The real trap: Cloudflare is NET, and "NETWORK" must not count as a mention.
    expect(
      isPrimarySubject(makeStory({ title: "Network outage hits cloud", relatedTickers: ["AMD"] }), "NET"),
    ).toBe(false);
    expect(
      isPrimarySubject(makeStory({ title: "NET surges on guidance", relatedTickers: ["AMD"] }), "NET"),
    ).toBe(true);
  });

  it("handles a ticker containing a dot without treating it as a wildcard", () => {
    expect(
      isPrimarySubject(makeStory({ title: "BRKXB rallies", relatedTickers: ["AMD"] }), "BRK.B"),
    ).toBe(false);
  });
});

describe("pickTopStory", () => {
  it("returns undefined when there are no stories", () => {
    expect(pickTopStory([], "NVDA", TODAY)).toBeUndefined();
  });

  it("ignores entries with no title or no link", () => {
    const stories = [makeStory({ title: "   " }), makeStory({ url: "" })];
    expect(pickTopStory(stories, "NVDA", TODAY)).toBeUndefined();
  });

  it("prefers a story the ticker leads over one that merely mentions it", () => {
    const mention = makeStory({
      title: "AMD Stock Tumbles Overnight",
      url: "https://example.com/amd",
      relatedTickers: ["AMD", "NVDA"],
      publishedAt: at(TODAY, 15), // newer, but not about NVDA
    });
    const subject = makeStory({
      title: "Nvidia lifts guidance",
      url: "https://example.com/nvda",
      relatedTickers: ["NVDA"],
      publishedAt: at(TODAY, 8),
    });

    const top = pickTopStory([mention, subject], "NVDA", TODAY);
    expect(top?.url).toBe("https://example.com/nvda");
    expect(top?.isPrimarySubject).toBe(true);
  });

  it("takes the newest when both are about the ticker", () => {
    const older = makeStory({ url: "https://example.com/older", publishedAt: at(TODAY, 8) });
    const newer = makeStory({ url: "https://example.com/newer", publishedAt: at(TODAY, 16) });
    expect(pickTopStory([older, newer], "NVDA", TODAY)?.url).toBe("https://example.com/newer");
  });

  it("prefers today's story over a better-matched older one", () => {
    const yesterdaySubject = makeStory({
      url: "https://example.com/yesterday",
      relatedTickers: ["NVDA"],
      publishedAt: at("2026-08-03", 16),
    });
    const todayMention = makeStory({
      title: "AMD tumbles",
      url: "https://example.com/today",
      relatedTickers: ["AMD", "NVDA"],
      publishedAt: at(TODAY, 7),
    });

    const top = pickTopStory([yesterdaySubject, todayMention], "NVDA", TODAY);
    expect(top?.url).toBe("https://example.com/today");
    expect(top?.isFromToday).toBe(true);
  });

  it("falls back to the newest older story and flags that it isn't from today", () => {
    const stories = [
      makeStory({ url: "https://example.com/old", publishedAt: at("2026-08-01", 10) }),
      makeStory({ url: "https://example.com/newer-old", publishedAt: at("2026-08-03", 10) }),
    ];
    const top = pickTopStory(stories, "NVDA", TODAY);
    expect(top?.url).toBe("https://example.com/newer-old");
    expect(top?.isFromToday).toBe(false);
  });

  it("treats a story with no timestamp as old, never as today's news", () => {
    const top = pickTopStory([makeStory({ publishedAt: new Date(0).toISOString() })], "NVDA", TODAY);
    expect(top?.isFromToday).toBe(false);
  });

  it("upper-cases the ticker it reports back", () => {
    expect(pickTopStory([makeStory()], "nvda", TODAY)?.ticker).toBe("NVDA");
  });
});

describe("getTopStory", () => {
  it("returns the ranked story for a valid ticker", async () => {
    const story = await getTopStory(fakeClient([makeStory()]), "NVDA", TODAY);
    expect(story?.title).toBe("Nvidia beats on earnings");
    expect(story?.publisher).toBe("Reuters");
  });

  it("normalizes a lower-case ticker before querying", async () => {
    const story = await getTopStory(fakeClient([makeStory()]), "  nvda  ", TODAY);
    expect(story?.ticker).toBe("NVDA");
  });

  it("returns undefined — not an error — when the provider has nothing", async () => {
    await expect(getTopStory(fakeClient([]), "NVDA", TODAY)).resolves.toBeUndefined();
  });

  it("propagates a provider failure, so 'no news' and 'lookup broke' stay distinguishable", async () => {
    await expect(getTopStory(fakeClient(new Error("HTTP 503")), "NVDA", TODAY)).rejects.toThrow(
      "HTTP 503",
    );
  });

  it("rejects a ticker that isn't one", async () => {
    const client = fakeClient([makeStory()]);
    await expect(getTopStory(client, "", TODAY)).rejects.toThrow();
    await expect(getTopStory(client, "NVDA OR 1=1", TODAY)).rejects.toThrow();
    await expect(getTopStory(client, "../../etc/passwd", TODAY)).rejects.toThrow();
  });
});
