// The front door. Everything outside src/lib/music imports from here and nowhere
// else, so the internals stay rearrangeable.

export {
  LIBRARY_VIEWS,
  LIBRARY_VIEW_ICONS,
  LIBRARY_VIEW_INFO,
  isLibraryView,
  labelForEmptyGroup,
  type LibraryFolder,
  type LibraryFolderNode,
  type LibraryGroup,
  type LibraryView,
  type Playlist,
  type PlaylistEntry,
} from "./browse";

export {
  DEFAULT_SCAN_EXTENSIONS,
  MUSIC_EXTENSIONS,
  MUSIC_FORMATS,
  STREAMABLE_EXTENSIONS,
  extensionOf,
  formatOf,
  isMusicExtension,
  type MusicExtension,
  type MusicFormat,
} from "./formats";

export {
  isScanRunStale,
  scanProgressPercent,
  type Album,
  type AlbumCover,
  type FolderNode,
  type ScanRun,
  type ScanRunProgress,
  type ScanStatus,
  type Track,
  type TrackFileFacts,
  type TrackSearchQuery,
  type TrackUpsert,
} from "./types";

export {
  cleanSearchTerm,
  deriveLyricsQuery,
  isDurationMatch,
  shouldRefetchLyrics,
  shouldSendDuration,
  type LyricsQuery,
  type LyricsStatus,
  type TrackLyrics,
} from "./lyrics";

export {
  MUSIC_SETTING_KEYS,
  musicSettingsToEntries,
  resolveMusicSettings,
  type MusicSettings,
} from "./settings";

export {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerMode,
  spectrumBars,
  waveformPoints,
  type VisualizerMode,
} from "./spectrum";

export {
  isSafeRelativePath,
  normaliseRelativePath,
  parentFolderOf,
  resolveTrackPath,
  toRelativePath,
} from "./paths";

export {
  contentRangeHeader,
  parseRangeHeader,
  unsatisfiableContentRangeHeader,
  type ByteRange,
  type RangeParseResult,
} from "./range";

export {
  addToPlaylistSchema,
  browsePageSchema,
  enqueueSchema,
  libraryViewSchema,
  playlistIdSchema,
  playlistWriteSchema,
  queueEntryIdSchema,
  reorderPlaylistSchema,
  reorderQueueSchema,
  repeatModeSchema,
  setQueueSchema,
  type AddToPlaylistInput,
  type BrowsePageInput,
  type EnqueueInput,
  type PlaylistWriteInput,
  type ReorderPlaylistInput,
  type ReorderQueueInput,
  type SetQueueInput,
} from "./schema";

export {
  fetchLyricsSchema,
  musicExtensionSchema,
  musicFolderSchema,
  musicSettingsSchema,
  startScanSchema,
  trackIdSchema,
  trackSearchSchema,
  type FetchLyricsInput,
  type MusicSettingsInput,
  type StartScanInput,
  type TrackSearchInput,
} from "./schema";

export type {
  AudioMetadataReader,
  LyricsClient,
  LyricsLookupResult,
  MusicFileStore,
  MusicRepository,
  TrackTags,
} from "./ports";

export {
  fetchTrackLyrics,
  getCachedLyrics,
  type FetchLyricsDependencies,
  type FetchLyricsOutcome,
} from "./lyrics-use-cases";

export {
  REPEAT_MODES,
  REPEAT_MODE_INFO,
  afterRemoving,
  currentIndex,
  currentItem,
  isRepeatMode,
  nextEntryId,
  previousEntryId,
  queueDurationSeconds,
  remainingDurationSeconds,
  shuffledEntryIds,
  type PlayQueue,
  type QueueEntry,
  type QueueItem,
  type QueueState,
  type RepeatMode,
} from "./queue";

export {
  advanceQueue,
  clearQueue,
  closeQueue,
  enqueueTracks,
  getPlayQueue,
  playQueueEntry,
  removeQueueEntry,
  reorderQueue,
  rewindQueue,
  setQueue,
  setRepeatMode,
  shuffleQueue,
  type QueueDependencies,
} from "./queue-use-cases";

export {
  getTrackForStreaming,
  listMusicFolders,
  openTrackRange,
  searchLibraryTracks,
  type StreamableTrack,
} from "./music";

export {
  refreshAlbumCounts,
  scanLibrary,
  type ScanDependencies,
  type ScanOptions,
  type ScanSummary,
} from "./scan";

// Server-only adapters are NOT re-exported here.
//
// This barrel is imported by client components for types and constants (the format
// table, the section metadata), and `file-store.ts` / `metadata-reader.ts` /
// `repository.ts` pull in `node:fs`, `better-sqlite3` and `music-metadata`. Re-exporting
// them puts those in the browser bundle's module graph, and Turbopack fails the build on
// a `node:` builtin it cannot polyfill -- which is exactly how this was found.
//
// Import them from their own paths instead. `wiring.ts` is the only place that should:
//
//   import { NodeMusicFileStore } from "@/lib/music/file-store";
//   import { MusicMetadataReader } from "@/lib/music/metadata-reader";
//   import { SqliteMusicRepository } from "@/lib/music/repository";
//   import { LrclibLyricsClient } from "@/lib/music/lrclib-client";
