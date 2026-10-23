// Topics — the public surface.
//
// A topic is a *term*, not a stored row: `/modules/journal/topics?topic=HSA` is
// the whole state of the screen. Nothing here reads or writes the database, and
// nothing here reads `module_settings` — the two journal preferences that steer
// matching (`topic_match_body`, `topic_episode_gap_days`) arrive as plain
// arguments, resolved by the caller. That is what lets the web view, the CLI
// (where flags can override the stored value for one run) and the tests all
// drive the same functions.

export {
  DEFAULT_SIMILARITY_THRESHOLD,
  acronymOf,
  containsTermAsWords,
  normalizeTerm,
  normalizeWords,
  termSimilarity,
  trigramSimilarity,
  trigrams,
} from "./fuzzy";

export { matchTopic, type MatchTopicOptions } from "./match";

export {
  DEFAULT_EPISODE_GAP_DAYS,
  MAX_EPISODE_GAP_DAYS,
  MIN_EPISODE_GAP_DAYS,
  buildEpisodes,
  clampEpisodeGapDays,
  daysBetween,
} from "./episodes";

export { buildCooccurrence, type CooccurrenceOptions } from "./cooccurrence";

export { suggestTopics, type SuggestTopicsOptions, type TopicSuggestion } from "./suggest";

export { MATCH_KIND_WEIGHT } from "./types";
export type {
  TopicCooccurrence,
  TopicEntry,
  TopicEpisode,
  TopicMatchKind,
  TopicMatchReason,
  TopicResult,
} from "./types";

export {
  topicGraphSubjects,
  topicMapSubjects,
  type TopicGraphSubject,
  type TopicMapSubject,
} from "./graph";

export {
  buildTopicMap,
  topicMapNodeKey,
  type BuildTopicMapOptions,
  type TopicMap,
  type TopicMapEdge,
  type TopicMapNode,
} from "./map";
