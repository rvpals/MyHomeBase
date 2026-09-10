import { describe, expect, it } from "vitest";
import { extractInitialData, parseSearchResults } from "./parse";
import {
  EMPTY_RESULTS_HTML,
  LIVE_RESULT_HTML,
  SEARCH_RESULTS_HTML,
} from "./youtube.fixture";

describe("extractInitialData", () => {
  it("finds the blob in a results page", () => {
    expect(extractInitialData(SEARCH_RESULTS_HTML)).toBeDefined();
  });

  it("returns undefined when the page carries no blob", () => {
    expect(extractInitialData("<html><body>no data here</body></html>")).toBeUndefined();
  });

  it("returns undefined rather than throwing on malformed json", () => {
    const broken = '<script>var ytInitialData = {"contents": [</script>';
    expect(extractInitialData(broken)).toBeUndefined();
  });
});

describe("parseSearchResults", () => {
  it("reads every video in relevance order", () => {
    const results = parseSearchResults(SEARCH_RESULTS_HTML);
    expect(results.map((entry) => entry.videoId)).toEqual([
      "SuFScoO4tb0",
      "u6OS0s3gCkA",
      "kAr0kEeeeee",
      "loop10hours",
    ]);
  });

  it("reads the title, channel and duration of a result", () => {
    const [first] = parseSearchResults(SEARCH_RESULTS_HTML);
    expect(first).toMatchObject({
      videoId: "SuFScoO4tb0",
      title: "Billy Joel - Honesty (Official Video)",
      channel: "billyjoelVEVO",
      durationSeconds: 227,
    });
  });

  it("converts a ten-hour badge rather than dropping it", () => {
    const loop = parseSearchResults(SEARCH_RESULTS_HTML).find(
      (entry) => entry.videoId === "loop10hours",
    );
    expect(loop?.durationSeconds).toBe(36000);
  });

  it("leaves duration undefined for a live stream with no badge", () => {
    const [live] = parseSearchResults(LIVE_RESULT_HTML);
    expect(live.videoId).toBe("liveStream1");
    expect(live.durationSeconds).toBeUndefined();
  });

  it("returns an empty list when the search matched nothing", () => {
    expect(parseSearchResults(EMPTY_RESULTS_HTML)).toEqual([]);
  });

  it("returns an empty list, not an error, when the payload shape changes", () => {
    const reshaped = `<script>var ytInitialData = ${JSON.stringify({
      contents: { somethingEntirelyNew: { results: [{ notAVideoRenderer: {} }] } },
    })};</script>`;
    expect(parseSearchResults(reshaped)).toEqual([]);
  });

  it("returns an empty list when the blob is missing entirely", () => {
    expect(parseSearchResults("<html><body>maintenance</body></html>")).toEqual([]);
  });

  it("deduplicates a video repeated across shelves", () => {
    const repeated = `<script>var ytInitialData = ${JSON.stringify({
      contents: [
        { itemSectionRenderer: { contents: [{ videoRenderer: { videoId: "dup00000001", title: { runs: [{ text: "Honesty" }] }, ownerText: { runs: [{ text: "Billy Joel" }] } } }] } },
        { shelfRenderer: { content: { videoRenderer: { videoId: "dup00000001", title: { runs: [{ text: "Honesty" }] }, ownerText: { runs: [{ text: "Billy Joel" }] } } } } },
      ],
    })};</script>`;
    expect(parseSearchResults(repeated)).toHaveLength(1);
  });

  it("skips a renderer with no id or no title", () => {
    const partial = `<script>var ytInitialData = ${JSON.stringify({
      contents: [
        { videoRenderer: { title: { runs: [{ text: "No id here" }] } } },
        { videoRenderer: { videoId: "notitle0001" } },
      ],
    })};</script>`;
    expect(parseSearchResults(partial)).toEqual([]);
  });

  it("falls back to longBylineText when a shelf result has no ownerText", () => {
    const shelf = `<script>var ytInitialData = ${JSON.stringify({
      contents: [
        {
          videoRenderer: {
            videoId: "shelf000001",
            title: { runs: [{ text: "Honesty" }] },
            longBylineText: { runs: [{ text: "billyjoelVEVO" }] },
          },
        },
      ],
    })};</script>`;
    expect(parseSearchResults(shelf)[0].channel).toBe("billyjoelVEVO");
  });
});
