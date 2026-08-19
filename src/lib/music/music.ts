import { parseRangeHeader, type ByteRange, type RangeParseResult } from "./range";
import type { MusicFileStore, MusicRepository } from "./ports";
import { trackSearchSchema, type TrackSearchInput } from "./schema";
import type { FolderNode, Track } from "./types";

// Browse and streaming use-cases. Functions taking data and returning data -- no
// Response objects, no headers, no fs. The route turns these results into HTTP.

/** Everything the streaming route needs to answer one request. */
export interface StreamableTrack {
  track: Track;
  /** The file's current size, re-stat'ed rather than trusted from the catalog. */
  fileSize: number;
  range: RangeParseResult;
}

/**
 * Resolves a track for streaming and works out which bytes to send.
 *
 * The size is re-read from disk rather than taken from `mus_tracks.file_size`,
 * because the catalog is a snapshot from the last scan and a stale size would produce
 * a wrong Content-Length or a truncated stream. A file that has vanished since the
 * scan returns `undefined`, which the route turns into a 404.
 *
 * An unplayable format (ape, wma) is deliberately still returned: the decision to
 * refuse it belongs to the caller, and the CLI may legitimately want the bytes.
 */
export async function getTrackForStreaming(
  deps: { musicRepo: MusicRepository; fileStore: MusicFileStore },
  trackId: number,
  rangeHeader: string | null,
): Promise<StreamableTrack | undefined> {
  const track = deps.musicRepo.getTrack(trackId);
  if (track === undefined) return undefined;

  const facts = await deps.fileStore.statFile(track.relativePath);
  if (facts === undefined) return undefined;

  return {
    track,
    fileSize: facts.fileSize,
    range: parseRangeHeader(rangeHeader, facts.fileSize),
  };
}

/** Opens the bytes for a resolved range. Separate so the decision is testable. */
export async function openTrackRange(
  fileStore: MusicFileStore,
  track: Track,
  range: ByteRange,
): Promise<ReadableStream<Uint8Array>> {
  return fileStore.openRange(track.relativePath, range.start, range.end);
}

/** A page of tracks for the library screen. Input is validated here, not in the view. */
export function searchLibraryTracks(
  musicRepo: MusicRepository,
  input: unknown,
): { tracks: Track[]; totalCount: number; query: TrackSearchInput } {
  const query = trackSearchSchema.parse(input);
  const { tracks, totalCount } = musicRepo.searchTracks(query);
  return { tracks, totalCount, query };
}

/**
 * The immediate sub-folders of a folder, for the scan screen's picker.
 *
 * Returns an empty list rather than throwing when the root is unavailable -- a NAS
 * that is asleep or unmounted is an expected state on a home network, and the screen
 * says so instead of erroring.
 */
export async function listMusicFolders(
  fileStore: MusicFileStore,
  relativeFolder: string,
): Promise<{ available: boolean; folders: FolderNode[] }> {
  if (!(await fileStore.isRootAvailable())) return { available: false, folders: [] };
  return { available: true, folders: await fileStore.listFolders(relativeFolder) };
}
