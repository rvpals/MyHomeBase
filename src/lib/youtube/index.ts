export type { VideoCandidate, VideoLookup, VideoQuery, VideoStatus } from "./types";
export type { VideoClient } from "./ports";
export { YouTubeVideoClient } from "./youtube-client";
export { parseSearchResults } from "./parse";
export {
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
