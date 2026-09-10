"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listModuleSettingsFor, saveModuleSettings } from "@/lib/module-settings";
import {
  getModuleTexture,
  removeModuleTextureImage,
  saveModuleTextureSettings,
  setModuleTextureImage,
  type ModuleTextureMode,
  type ModuleTextureSettings,
} from "@/lib/module-texture";
import { getModuleBySlug } from "@/lib/modules";
import {
  addToPlaylistSchema,
  browsePageSchema,
  fetchLyricsSchema,
  fetchStorySchema,
  fetchTrackLyrics,
  fetchTrackStory,
  fetchTrackVideo,
  fetchVideoSchema,
  readCachedVideo,
  libraryViewSchema,
  playlistIdSchema,
  playlistWriteSchema,
  reorderPlaylistSchema,
  trackIdSchema,
  getCachedLyrics,
  isScanRunStale,
  isVisualizerMode,
  listMusicFolders,
  musicFolderSchema,
  musicSettingsSchema,
  musicSettingsToEntries,
  resolveMusicSettings,
  scanLibrary,
  scanProgressPercent,
  searchLibraryTracks,
  startScanSchema,
  type MusicExtension,
  type MusicRepository,
  type TrackLyrics,
  type VisualizerMode,
} from "@/lib/music";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "music-library";

// Server actions for the Music Library. Thin on purpose: validate at the boundary,
// call a use-case, return data. Nothing here decides anything -- the decisions live in
// src/lib/music.

const MUSIC_LIBRARY_SLUG = "music-library";

/**
 * The module's settings rows.
 *
 * `sys_module_settings` is keyed by module id, not slug, so this resolves the row
 * first. Returns [] when the module is not registered, which resolveMusicSettings
 * reads as "use the defaults" rather than failing.
 */
function readMusicSettings() {
  const musicModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);
  return resolveMusicSettings(
    musicModule === undefined
      ? []
      : listModuleSettingsFor(deps.moduleSettingsRepo, musicModule.id),
  );
}

async function requireUser() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not signed in.");
  return currentUser;
}

export interface StoryActionResult {
  status: "found" | "not_found" | "failed" | "unsearchable";
  /** The facts, in page order. Empty unless status is `found`. */
  facts: string[];
  /** The Songfacts page the facts came from, for the attribution link. */
  sourceUrl?: string;
  /** A Songfacts search to open by hand when our URL guesses missed. */
  searchUrl?: string;
  /** What Songfacts says the page is about, so landing on the wrong song is visible. */
  matchedFor?: string;
  message?: string;
}

export interface LyricsActionResult {
  status: "found" | "instrumental" | "not_found" | "failed" | "unsearchable";
  lyrics: string;
  /** What was actually searched for, so a miss can be understood rather than guessed at. */
  searchedFor?: string;
  message?: string;
}

export interface VideoActionResult {
  status: "found" | "not_found" | "failed" | "unsearchable";
  /** The 11-character YouTube id. Present only when status is `found`. */
  videoId?: string;
  /** The title as YouTube reported it, so landing on the wrong song is visible. */
  videoTitle?: string;
  channel?: string;
  /** A YouTube search to run by hand when we would not pick a video. */
  searchUrl?: string;
  /** True when this came from `mus_track_video` rather than a fresh scrape. */
  fromCache?: boolean;
  message?: string;
}

/**
 * Fetches lyrics for a track, or returns the cached answer.
 *
 * `force` re-asks for something already cached -- the "try again" affordance for a
 * previous miss. Hand-entered lyrics are never overwritten, force or not; the
 * use-case enforces that, not this action.
 */
export async function fetchLyricsAction(input: {
  trackId: number;
  force?: boolean;
}): Promise<LyricsActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = fetchLyricsSchema.parse(input);

  const outcome = await fetchTrackLyrics(
    { musicRepo: deps.musicRepo, lyricsClient: deps.lyricsClient },
    parsed.trackId,
    { force: parsed.force },
  );

  if (outcome.kind === "no-such-track") {
    return { status: "failed", lyrics: "", message: "That track is no longer in the library." };
  }
  if (outcome.kind === "unsearchable") {
    return { status: "unsearchable", lyrics: "", message: outcome.reason };
  }

  return toResult(outcome.lyrics);
}

/** The cached lyrics for a track, without asking the service. */
/**
 * Whether the player should look lyrics up on its own.
 *
 * Its own action rather than reading `getMusicSettingsAction`, which also counts every
 * track in the library -- the player asks this on each track change and has no use for
 * the rest of that payload.
 */
export async function getAutoFetchLyricsAction(): Promise<boolean> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return readMusicSettings().autoFetchLyrics;
}

/**
 * Which visualizer the player screen draws.
 *
 * Its own pair of actions rather than the configuration form's, for the same reason
 * `getAutoFetchLyricsAction` above is separate: `getMusicSettingsAction` counts every
 * track in the library, which is a wasteful thing to do to answer "bars or wave".
 */
export async function getVisualizerModeAction(): Promise<VisualizerMode> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return readMusicSettings().visualizerMode;
}

/**
 * Stores the visualizer choice, leaving every other setting alone.
 *
 * `musicSettingsToEntries` writes the WHOLE settings set, so this reads the current
 * values first and changes one field. Writing a bare entry list instead would blank
 * the scan allowlist the moment someone pressed a button on the player screen.
 */
export async function setVisualizerModeAction(
  mode: VisualizerMode,
): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  if (!isVisualizerMode(mode)) return { error: "That is not a visualizer mode." };

  const musicModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);
  if (musicModule === undefined) return { error: "The Music Library module is not registered." };

  saveModuleSettings(deps.moduleSettingsRepo, {
    moduleId: musicModule.id,
    entries: musicSettingsToEntries({ ...readMusicSettings(), visualizerMode: mode }),
  });
  return { ok: true };
}

export async function getLyricsAction(trackId: number): Promise<LyricsActionResult | undefined> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const cached = getCachedLyrics(deps.musicRepo, trackId);
  return cached === undefined ? undefined : toResult(cached);
}

/**
 * The story behind a track, fetched fresh from songfacts.com.
 *
 * Nothing is cached, by design -- the story is viewed, not stored, so there is no
 * table behind this and no `force` to pass. The player calls it once per track.
 */
export async function fetchStoryAction(input: { trackId: number }): Promise<StoryActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = fetchStorySchema.parse(input);

  const outcome = await fetchTrackStory(
    { musicRepo: deps.musicRepo, storyClient: deps.storyClient },
    parsed.trackId,
  );

  if (outcome.kind === "found") {
    const { story } = outcome;
    const matchedFor =
      story.matchedTitle === undefined || story.matchedTitle === ""
        ? undefined
        : [story.matchedTitle, story.matchedArtist]
            .filter((part) => part !== undefined && part !== "")
            .join(" by ");
    return { status: "found", facts: story.facts, sourceUrl: story.sourceUrl, matchedFor };
  }

  if (outcome.kind === "not-found") {
    return {
      status: "not_found",
      facts: [],
      searchUrl: outcome.searchUrl,
      message: "No story found for this song on Songfacts.",
    };
  }

  if (outcome.kind === "unsearchable") {
    return { status: "unsearchable", facts: [], message: outcome.reason };
  }

  if (outcome.kind === "no-such-track") {
    return { status: "failed", facts: [], message: "That track is no longer in the library." };
  }

  return {
    status: "failed",
    facts: [],
    message: "Could not reach Songfacts. It will try again next time this song plays.",
  };
}

/**
 * The YouTube video for a track.
 *
 * Cached in `mus_track_video`, so the common case makes no request at all. Fetched
 * only when the listener presses "Find video" -- never automatically, because a scrape
 * of a free service for a video nobody asked to watch is not a request worth making.
 *
 * `force` is the Refresh path and bypasses a cached hit. A cached *miss* is retried
 * without it: no miss here is ever permanent.
 */
export async function fetchVideoAction(input: {
  trackId: number;
  force?: boolean;
}): Promise<VideoActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = fetchVideoSchema.parse(input);

  const outcome = await fetchTrackVideo(
    { musicRepo: deps.musicRepo, videoClient: deps.videoClient },
    parsed.trackId,
    parsed.force,
  );

  if (outcome.kind === "found") {
    return {
      status: "found",
      videoId: outcome.video.videoId,
      videoTitle: outcome.video.videoTitle,
      channel: outcome.video.channel,
      searchUrl: outcome.searchUrl,
      fromCache: outcome.fromCache,
    };
  }

  if (outcome.kind === "not-found") {
    return {
      status: "not_found",
      searchUrl: outcome.searchUrl,
      message: "No video found for this song on YouTube.",
    };
  }

  if (outcome.kind === "unsearchable") {
    return { status: "unsearchable", message: outcome.reason };
  }

  if (outcome.kind === "no-such-track") {
    return { status: "failed", message: "That track is no longer in the library." };
  }

  return {
    status: "failed",
    searchUrl: outcome.searchUrl,
    message: "Could not reach YouTube. Try again in a moment.",
  };
}

/**
 * The cached video for a track, without going near the network.
 *
 * What the Video tab calls on mount: a track already looked up shows its video
 * straight away, and the button reads "Refresh" instead of "Find video".
 */
export async function getVideoAction(trackId: number): Promise<VideoActionResult | undefined> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsedId = trackIdSchema.parse(trackId);

  const outcome = readCachedVideo({ musicRepo: deps.musicRepo }, parsedId);
  if (outcome === undefined) return undefined;

  if (outcome.kind === "found") {
    return {
      status: "found",
      videoId: outcome.video.videoId,
      videoTitle: outcome.video.videoTitle,
      channel: outcome.video.channel,
      searchUrl: outcome.searchUrl,
      fromCache: true,
    };
  }

  if (outcome.kind === "not-found") {
    return {
      status: "not_found",
      searchUrl: outcome.searchUrl,
      message: "No video found for this song on YouTube.",
    };
  }

  if (outcome.kind === "failed") {
    return {
      status: "failed",
      searchUrl: outcome.searchUrl,
      message: "The last search could not reach YouTube.",
    };
  }

  return undefined;
}

/** A page of tracks for the library screen. */
export async function searchTracksAction(input: {
  search?: string;
  folder?: string;
  streamableOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const { tracks, totalCount } = searchLibraryTracks(deps.musicRepo, input);
  return { tracks, totalCount };
}

function toResult(lyrics: TrackLyrics): LyricsActionResult {
  const searchedFor =
    lyrics.searchTitle === ""
      ? undefined
      : [lyrics.searchArtist, lyrics.searchTitle].filter((part) => part !== "").join(" - ");

  if (lyrics.status === "found") {
    return { status: "found", lyrics: lyrics.lyrics, searchedFor };
  }
  if (lyrics.status === "instrumental") {
    return {
      status: "instrumental",
      lyrics: "",
      searchedFor,
      message: "This track is instrumental - there are no lyrics.",
    };
  }
  if (lyrics.status === "not_found") {
    return {
      status: "not_found",
      lyrics: "",
      searchedFor,
      message: "No lyrics found for this track.",
    };
  }
  return {
    status: "failed",
    lyrics: "",
    searchedFor,
    message: "Could not reach the lyrics service. Try again.",
  };
}

/** Re-renders the module's pages after something changed. */
export async function revalidateMusicAction() {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  revalidatePath("/modules/music-library");
}

// --- scanning ------------------------------------------------------------------

/**
 * Starts a scan and returns immediately with the run id.
 *
 * Deliberately does NOT await the scan. On the NAS -- a DS223 with 2 GB of RAM,
 * already swapping at idle -- reading tags across 20k files takes minutes to tens of
 * minutes, which no HTTP request can hold open. The scan runs on after this action
 * returns and writes its progress to `mus_scan_runs`; the UI polls `getScanStatusAction`
 * for the percentage and the current filename. A page refresh mid-scan therefore still
 * sees live progress, which in-memory state could not offer.
 */
export async function startScanAction(input: {
  folder?: string;
  extensions?: string[];
}): Promise<{ scanRunId: number } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const existing = deps.musicRepo.getActiveScanRun();
  if (existing !== undefined && !isScanRunStale(existing, new Date())) {
    return { error: "A scan is already running." };
  }

  const settings = readMusicSettings();
  const parsed = startScanSchema.safeParse({
    folder: input.folder ?? "",
    extensions: input.extensions ?? settings.scanExtensions,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That scan request is not valid." };
  }

  const scanRunId = deps.musicRepo.createScanRun({
    rootFolder: parsed.data.folder,
    extensions: parsed.data.extensions,
  });

  // Fire and forget, with the run row as the channel. The `void` is the point: awaiting
  // here would tie the scan's lifetime to this request's.
  void runScanInBackground(scanRunId, parsed.data.folder, parsed.data.extensions, settings.skipUnstreamable);

  return { scanRunId };
}

/**
 * Runs the scan outside the request.
 *
 * `createScanRun` already made the row this reports into, so `scanLibrary` is handed a
 * repository wrapper that reuses it rather than opening a second run -- otherwise the
 * UI would poll one row while the work reported into another.
 */
async function runScanInBackground(
  scanRunId: number,
  folder: string,
  extensions: MusicExtension[],
  skipUnstreamable: boolean,
): Promise<void> {
  // A Proxy rather than an object spread: `deps.musicRepo` is a class instance, so its
  // methods live on the prototype and `{ ...instance }` would copy none of them. The
  // only override is createScanRun -- the run row already exists, and handing back its
  // id keeps the work reporting into the row the UI is polling instead of a second one.
  const repoForRun = new Proxy(deps.musicRepo, {
    get(target, property, receiver) {
      if (property === "createScanRun") return () => scanRunId;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as MusicRepository;

  try {
    await scanLibrary(
      {
        musicRepo: repoForRun,
        fileStore: deps.musicFileStore,
        metadataReader: deps.musicMetadataReader,
      },
      { folder, extensions, skipUnstreamable, pruneMissing: true },
    );
  } catch (error) {
    // scanLibrary already records per-file problems; this is the last resort so a run
    // never stays 'running' forever after an unexpected throw.
    deps.musicRepo.finishScanRun(
      scanRunId,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export interface ScanStatusView {
  id: number;
  status: string;
  rootFolder: string;
  /** undefined while phase one is still counting -- the bar shows indeterminate. */
  percent?: number;
  filesTotal: number;
  filesSeen: number;
  tracksAdded: number;
  tracksUpdated: number;
  filesSkipped: number;
  filesFailed: number;
  currentPath: string;
  lastError: string;
  startedAt: string;
  finishedAt?: string;
  /** True when a 'running' row has gone quiet -- a process restart, not live work. */
  isStale: boolean;
}

/** The current (or a specific) scan's progress, for polling. */
export async function getScanStatusAction(scanRunId?: number): Promise<ScanStatusView | undefined> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  // Reconcile first: a scan killed with its process left a 'running' row that would
  // otherwise win getActiveScanRun() forever and show as frozen.
  deps.musicRepo.failAbandonedScanRuns();
  const run =
    scanRunId === undefined
      ? deps.musicRepo.getActiveScanRun()
      : deps.musicRepo.getScanRun(scanRunId);
  if (run === undefined) return undefined;

  return {
    id: run.id,
    status: run.status,
    rootFolder: run.rootFolder,
    percent: scanProgressPercent(run),
    filesTotal: run.filesTotal,
    filesSeen: run.filesSeen,
    tracksAdded: run.tracksAdded,
    tracksUpdated: run.tracksUpdated,
    filesSkipped: run.filesSkipped,
    filesFailed: run.filesFailed,
    currentPath: run.currentPath,
    lastError: run.lastError,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    isStale: isScanRunStale(run, new Date()),
  };
}

/** The last few scans, so the screen can show history rather than only "now". */
export async function listRecentScansAction(limit = 5): Promise<ScanStatusView[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  deps.musicRepo.failAbandonedScanRuns();
  return deps.musicRepo.listRecentScanRuns(limit).map((run) => ({
    id: run.id,
    status: run.status,
    rootFolder: run.rootFolder,
    percent: scanProgressPercent(run),
    filesTotal: run.filesTotal,
    filesSeen: run.filesSeen,
    tracksAdded: run.tracksAdded,
    tracksUpdated: run.tracksUpdated,
    filesSkipped: run.filesSkipped,
    filesFailed: run.filesFailed,
    currentPath: run.currentPath,
    lastError: run.lastError,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    isStale: isScanRunStale(run, new Date()),
  }));
}

/** The immediate sub-folders of a folder, for the picker. */
export async function listFoldersAction(
  folder: string,
): Promise<{ available: boolean; folders: { name: string; relativePath: string; hasChildren: boolean }[] }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = musicFolderSchema.safeParse(folder);
  if (!parsed.success) return { available: true, folders: [] };
  return listMusicFolders(deps.musicFileStore, parsed.data);
}

// --- configuration -------------------------------------------------------------

export async function getMusicSettingsAction(): Promise<{
  scanExtensions: string[];
  skipUnstreamable: boolean;
  autoFetchLyrics: boolean;
  musicRootConfigured: boolean;
  trackCount: number;
}> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const settings = readMusicSettings();
  return {
    scanExtensions: settings.scanExtensions,
    skipUnstreamable: settings.skipUnstreamable,
    autoFetchLyrics: settings.autoFetchLyrics,
    musicRootConfigured: deps.musicRoot.trim() !== "",
    trackCount: deps.musicRepo.countTracks(),
  };
}

export async function saveMusicSettingsAction(input: {
  scanExtensions: string[];
  skipUnstreamable: boolean;
  autoFetchLyrics?: boolean;
}): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  // The visualizer mode is carried through from what is stored, not taken from the
  // form: this screen has no control for it (the player screen does), and
  // `musicSettingsToEntries` writes every key -- so omitting it here would silently
  // reset someone's choice each time they saved the scan settings.
  const parsed = musicSettingsSchema.safeParse({
    ...input,
    visualizerMode: readMusicSettings().visualizerMode,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those settings are not valid." };
  }

  const musicModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);
  if (musicModule === undefined) return { error: "The Music Library module is not registered." };

  saveModuleSettings(deps.moduleSettingsRepo, {
    moduleId: musicModule.id,
    entries: musicSettingsToEntries(parsed.data),
  });
  revalidatePath("/modules/music-library/configuration");
  return { ok: true };
}

// --- browse views (the Library section's eight tabs) ---------------------------

export async function listArtistsAction(input: { search?: string; limit?: number; offset?: number }) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const page = browsePageSchema.parse(input);
  return deps.musicRepo.listArtists(page);
}

export async function listGenresAction() {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return deps.musicRepo.listGenres();
}

export async function listYearsAction() {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return deps.musicRepo.listYears();
}

export async function listFoldersFlatAction(input: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const page = browsePageSchema.parse(input);
  return deps.musicRepo.listTrackFolders(page);
}

/** One level of the folder tree. Reads the catalog, so it works with the NAS asleep. */
export async function listFolderTreeAction(folder: string) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = musicFolderSchema.safeParse(folder);
  if (!parsed.success) return [];
  return deps.musicRepo.listFolderChildren(parsed.data);
}

/**
 * Tracks for a group: one artist, genre, year, or folder subtree.
 *
 * `key` is matched exactly for artist and genre (that is how the group was derived), and
 * as a subtree prefix for a folder. An empty key means the untagged group, which is a real
 * category here -- plenty of this library carries no genre or year.
 */
export async function listGroupTracksAction(input: {
  view: string;
  key: string;
  limit?: number;
  offset?: number;
}) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const view = libraryViewSchema.parse(input.view);
  const page = browsePageSchema.parse({ limit: input.limit, offset: input.offset });

  if (view === "folders" || view === "folder-tree") {
    const folder = musicFolderSchema.parse(input.key);
    return searchLibraryTracks(deps.musicRepo, { folder, ...page });
  }

  const { tracks, totalCount } = deps.musicRepo.searchTracks({
    artist: view === "artists" ? input.key : undefined,
    genre: view === "genres" ? input.key : undefined,
    releaseYear:
      view === "years" ? (input.key === "" ? null : Number(input.key)) : undefined,
    limit: page.limit,
    offset: page.offset,
  });
  return { tracks, totalCount, query: page };
}

// --- most played ---------------------------------------------------------------

export async function listMostPlayedAction(input: { limit?: number; offset?: number }) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const page = browsePageSchema.parse(input);
  return deps.musicRepo.listMostPlayed(page);
}

/**
 * Records that a track started playing.
 *
 * Fire-and-forget from the player's point of view: this must never be the reason playback
 * fails, so a problem here is swallowed rather than surfaced. "Started" is the chosen
 * definition of a play -- see migrations/0056 for what that does and does not measure.
 */
export async function recordPlayAction(trackId: number): Promise<void> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const currentUser = await requireUser();
    deps.musicRepo.recordPlay(trackIdSchema.parse(trackId), currentUser.id);
  } catch {
    // Deliberately silent.
  }
}

// --- playlists ------------------------------------------------------------------

export async function listPlaylistsAction() {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return deps.musicRepo.listPlaylists();
}

export async function getPlaylistTracksAction(playlistId: number) {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const id = playlistIdSchema.parse(playlistId);
  return {
    playlist: deps.musicRepo.getPlaylist(id),
    entries: deps.musicRepo.listPlaylistTracks(id),
  };
}

export async function createPlaylistAction(input: {
  name: string;
  description?: string;
}): Promise<{ id: number } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = playlistWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That playlist is not valid." };
  }
  try {
    const id = deps.musicRepo.createPlaylist(parsed.data);
    revalidatePath("/modules/music-library");
    return { id };
  } catch {
    // The unique index on name is the likely cause, and "already exists" is more useful
    // than the driver's constraint message.
    return { error: `A playlist called "${parsed.data.name}" already exists.` };
  }
}

export async function renamePlaylistAction(input: {
  playlistId: number;
  name: string;
  description?: string;
}): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const id = playlistIdSchema.parse(input.playlistId);
  const parsed = playlistWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That playlist is not valid." };
  }
  try {
    deps.musicRepo.updatePlaylist(id, parsed.data);
    revalidatePath("/modules/music-library");
    return { ok: true };
  } catch {
    return { error: `A playlist called "${parsed.data.name}" already exists.` };
  }
}

export async function deletePlaylistAction(playlistId: number): Promise<{ ok: true }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  // Deletes the list only. No track row and no music file is touched.
  deps.musicRepo.deletePlaylist(playlistIdSchema.parse(playlistId));
  revalidatePath("/modules/music-library");
  return { ok: true };
}

export async function addToPlaylistAction(input: {
  playlistId: number;
  trackIds: number[];
}): Promise<{ ok: true; added: number } | { error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = addToPlaylistSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nothing to add." };
  }
  deps.musicRepo.addTracksToPlaylist(parsed.data.playlistId, parsed.data.trackIds);
  revalidatePath("/modules/music-library");
  return { ok: true, added: parsed.data.trackIds.length };
}

export async function removeFromPlaylistAction(playlistTrackId: number): Promise<{ ok: true }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  // Removes ONE entry, not every copy of the track -- a playlist may hold it twice.
  deps.musicRepo.removePlaylistEntry(playlistIdSchema.parse(playlistTrackId));
  revalidatePath("/modules/music-library");
  return { ok: true };
}

export async function reorderPlaylistAction(input: {
  playlistId: number;
  orderedPlaylistTrackIds: number[];
}): Promise<{ ok: true }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = reorderPlaylistSchema.parse(input);
  deps.musicRepo.reorderPlaylist(parsed.playlistId, parsed.orderedPlaylistTrackIds);
  return { ok: true };
}

// --- background picture (migrations/0064) ---------------------------------------
//
// Gated on `requireUser`, not on admin, deliberately: it matches
// `saveMusicSettingsAction` directly above, and everything on this module's
// Configuration screen is reachable by anyone who can reach the screen. Making
// this one control stricter than the toggles beside it would be surprising rather
// than safer. (The dashboard texture IS admin-only, because it's in
// Administration -- the gate follows the screen, not the feature.)

export interface MusicTextureResult {
  ok: boolean;
  error?: string;
}

/** Replaces the module's background picture. */
export async function saveMusicTextureImageAction(formData: FormData): Promise<MusicTextureResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const file = formData.get("image");
    if (!(file instanceof File)) return { ok: false, error: "No image was received." };

    setModuleTextureImage(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG, {
      // Cast because the value came off a File and is unvalidated until the lib
      // schema narrows it to the allowed set.
      mimeType: file.type as never,
      base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
    // "layout" because the picture is applied by the module shell, which wraps
    // every section rather than only the form that changed it.
    revalidatePath("/modules/music-library", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the image.",
    };
  }
}

/** Clears the picture, returning the module to the theme's flat paper. */
export async function removeMusicTextureImageAction(): Promise<MusicTextureResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    removeModuleTextureImage(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG);
    revalidatePath("/modules/music-library", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not remove the image.",
    };
  }
}

/** Saves opacity / mode / blur, leaving the picture in place. */
export async function saveMusicTextureSettingsAction(
  input: ModuleTextureSettings,
): Promise<MusicTextureResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveModuleTextureSettings(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG, input);
    revalidatePath("/modules/music-library", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the settings.",
    };
  }
}

/** The current picture settings, for the configuration screen to edit. */
export async function getMusicTextureAction(): Promise<{
  hasImage: boolean;
  imageVersion: string;
  opacity: number;
  mode: ModuleTextureMode;
  blur: number;
}> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const texture = getModuleTexture(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG);
  return {
    hasImage: texture.hasImage,
    imageVersion: texture.updatedAt,
    opacity: texture.opacity,
    mode: texture.mode,
    blur: texture.blur,
  };
}
