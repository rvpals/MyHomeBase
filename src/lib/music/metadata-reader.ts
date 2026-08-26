import { parseFile } from "music-metadata";
import { resolveTrackPath } from "./paths";
import type { AudioMetadataReader, TrackTags } from "./ports";

// Embedded-tag reading, via `music-metadata` (MIT, pure JS -- deliberately no native
// binary, so scripts/publish-nas.mjs keeps `better-sqlite3` as the only thing needing
// an arm64 prebuild).
//
// This is the expensive half of a scan: it opens and parses every file, which over SMB
// in dev is what makes a full pass take minutes. Behind a port so the scanner can be
// tested with fake tags and no audio at all.

export class MusicMetadataReader implements AudioMetadataReader {
  constructor(private readonly musicRoot: string) {}

  /**
   * Tags for one file, or `undefined` when it cannot be parsed.
   *
   * Resolves rather than rejects on a bad file: one corrupt track in twenty thousand
   * must not end a scan. The scanner counts it in `files_failed` and moves on.
   */
  async read(relativePath: string): Promise<TrackTags | undefined> {
    const absolute = resolveTrackPath(this.musicRoot, relativePath);
    if (absolute === undefined) return undefined;

    try {
      // NOT `duration: true`. That flag makes music-metadata read the *whole file* when
      // the duration isn't in the header, which over SMB means pulling every byte across
      // the network for a tag read. Measured on the NAS: 25ms -> 417ms on a 1 MB mp3,
      // 248ms -> 1937ms on a 5.7 MB one, an 8-16x cost. Across a 10.9 GB folder that is
      // the difference between a scan that finishes and one that gets killed mid-run,
      // leaving an orphaned 'running' row the UI reports as "stopped reporting".
      //
      // Most files carry the duration in their header anyway, and those still come back
      // populated for free. Where it's genuinely absent we now store nothing rather than
      // paying a full file read for it -- duration only disambiguates a lyrics match
      // between a studio and a live cut, which is not worth a scan that cannot complete.
      const metadata = await parseFile(absolute);
      const common = metadata.common;

      // The first embedded picture only. A file can carry front cover, back cover and
      // a disc scan; the library shows one thumbnail, so the rest are dead weight in a
      // BLOB column.
      const picture = common.picture?.[0];

      return {
        title: cleanTag(common.title),
        artist: cleanTag(common.artist),
        album: cleanTag(common.album),
        albumArtist: cleanTag(common.albumartist),
        genre: cleanTag(common.genre?.[0]),
        releaseYear: positiveInteger(common.year),
        trackNumber: positiveInteger(common.track?.no ?? undefined),
        discNumber: positiveInteger(common.disk?.no ?? undefined),
        durationSeconds: positiveInteger(
          metadata.format.duration === undefined ? undefined : Math.round(metadata.format.duration),
        ),
        cover:
          picture === undefined
            ? undefined
            : {
                data: Buffer.from(picture.data),
                mimeType: picture.format,
              },
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * Trims a tag and treats blank as absent.
 *
 * Tags in the wild are full of `"   "` and empty strings, and the domain stores `''`
 * for "not known" -- so normalising here keeps every downstream fallback (filename for
 * a title, "Unknown Album" for grouping) working off one consistent notion of empty.
 */
function cleanTag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A positive integer, or `undefined`.
 *
 * Year 0, track 0 and a negative duration all mean "the tag was there but says
 * nothing", and storing them would put `0` in the UI where a blank belongs.
 */
function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}
