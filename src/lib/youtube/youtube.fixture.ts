// A trimmed YouTube results page, for the parser test.
//
// Captured from a real `youtube.com/results?search_query=Billy+Joel+Honesty` response
// and cut down by hand: the real payload is 1.3 MB of player config, tracking params
// and sidebar chrome, and none of it is what the parser reads. The `videoRenderer`
// shapes below are verbatim -- the field names, the `runs`/`simpleText` split and the
// nesting under `itemSectionRenderer` are exactly as YouTube sends them.
//
// The results are chosen to cover what ranking has to get right, not just to parse:
// the official upload, a lyrics re-upload, a karaoke track, and a ten-hour loop.

/** One results page with four videos, wrapped in the real container path. */
export const SEARCH_RESULTS_HTML = `<!DOCTYPE html><html><head><title>Billy Joel Honesty - YouTube</title></head>
<body><script nonce="x">var ytInitialData = ${JSON.stringify({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    videoRenderer: {
                      videoId: "SuFScoO4tb0",
                      title: { runs: [{ text: "Billy Joel - Honesty (Official Video)" }] },
                      ownerText: { runs: [{ text: "billyjoelVEVO" }] },
                      longBylineText: { runs: [{ text: "billyjoelVEVO" }] },
                      lengthText: { simpleText: "3:47" },
                      badges: [
                        {
                          metadataBadgeRenderer: {
                            style: "BADGE_STYLE_TYPE_SIMPLE",
                            label: "CC",
                          },
                        },
                      ],
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: "u6OS0s3gCkA",
                      title: { runs: [{ text: "Billy Joel - Honesty (Lyrics)" }] },
                      ownerText: { runs: [{ text: "7clouds Rock" }] },
                      lengthText: { simpleText: "3:49" },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: "kAr0kEeeeee",
                      title: { runs: [{ text: "Honesty - Billy Joel | Karaoke Version" }] },
                      ownerText: { runs: [{ text: "Sing King Karaoke" }] },
                      lengthText: { simpleText: "3:52" },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: "loop10hours",
                      title: { runs: [{ text: "Billy Joel - Honesty [10 hours]" }] },
                      ownerText: { runs: [{ text: "Relax Loops" }] },
                      lengthText: { simpleText: "10:00:00" },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
})};</script></body></html>`;

/** A results page for a query nothing matched -- the blob is there, the results are not. */
export const EMPTY_RESULTS_HTML = `<!DOCTYPE html><html><body><script nonce="x">var ytInitialData = ${JSON.stringify(
  {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{ itemSectionRenderer: { contents: [{ backgroundPromoRenderer: {} }] } }],
          },
        },
      },
    },
  },
)};</script></body></html>`;

/** A live stream: a `videoRenderer` whose badge is not a length. */
export const LIVE_RESULT_HTML = `<html><body><script>var ytInitialData = ${JSON.stringify({
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              {
                videoRenderer: {
                  videoId: "liveStream1",
                  title: { runs: [{ text: "Billy Joel Honesty - 24/7 Radio" }] },
                  ownerText: { runs: [{ text: "Billy Joel" }] },
                  // A live result carries no lengthText at all.
                },
              },
            ],
          },
        },
      ],
    },
  },
})};</script></body></html>`;
