// Scans the music folder and catalogs what it finds.
//
// This is the command to use for the FIRST scan of a large library. Reading tags on
// 20k files takes minutes to tens of minutes, and over SSH that is a normal thing for a
// command to do -- you see the output and nothing is waiting on a browser. Afterwards
// the web button is the better tool, because unchanged files are skipped and a re-scan
// takes seconds.
//
// Usage:
//   npm run cli -- scan-music [folder] [--formats mp3,flac] [--limit N]
//                             [--include-unplayable] [--no-prune]
//
//   npm run cli -- scan-music                       # everything, using saved settings
//   npm run cli -- scan-music CHINESE               # just that folder
//   npm run cli -- scan-music CHINESE --limit 500   # time a sample first
//
// `--limit` exists to turn a guess into a measurement: run 500 files, look at the
// elapsed time, then decide whether to commit to the whole library.

import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import {
  isMusicExtension,
  resolveMusicSettings,
  scanLibrary,
  type MusicExtension,
} from "@/lib/music";
import { deps } from "@/lib/wiring";

const MUSIC_LIBRARY_SLUG = "music-library";

export async function scanMusicCommand(args: string[]): Promise<void> {
  const folder = args.find((arg) => !arg.startsWith("--")) ?? "";
  const formatsArg = valueOf(args, "--formats");
  const limitArg = valueOf(args, "--limit");
  const includeUnplayable = args.includes("--include-unplayable");
  const noPrune = args.includes("--no-prune");

  if (deps.musicRoot.trim() === "") {
    console.error("MYHOMEBASE_MUSIC_ROOT is not set, so there is no music folder to scan.");
    console.error("  dev (Windows): //NAS_DS223/MEDIA/AUDIO");
    console.error("  NAS:           /volume1/MEDIA/AUDIO");
    process.exitCode = 1;
    return;
  }

  const musicModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);
  const settings = resolveMusicSettings(
    musicModule ? listModuleSettingsFor(deps.moduleSettingsRepo, musicModule.id) : [],
  );

  let extensions: MusicExtension[] = settings.scanExtensions;
  if (formatsArg !== undefined) {
    const requested = formatsArg
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== "");
    const unknown = requested.filter((entry) => !isMusicExtension(entry));
    if (unknown.length > 0) {
      console.error(`Not audio formats this app knows: ${unknown.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    extensions = requested.filter(isMusicExtension);
  }

  const limit = limitArg === undefined ? undefined : Number(limitArg);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    console.error(`--limit must be a positive whole number, got "${limitArg}".`);
    process.exitCode = 1;
    return;
  }

  console.log(`Music root:  ${deps.musicRoot}`);
  console.log(`Folder:      ${folder === "" ? "(everything)" : folder}`);
  console.log(`Formats:     ${extensions.join(", ")}`);
  console.log(`Unplayable:  ${includeUnplayable ? "catalogued" : "skipped"}`);
  if (limit !== undefined) console.log(`Limit:       ${limit} files (sample)`);
  console.log("");

  const started = Date.now();
  let lastReported = 0;

  // Progress is written to mus_scan_runs by the scanner; this polls the same row the
  // web UI polls, so both show the same numbers.
  const timer = setInterval(() => {
    const run = deps.musicRepo.getActiveScanRun();
    if (run === undefined || run.filesSeen === lastReported) return;
    lastReported = run.filesSeen;
    const percent =
      run.filesTotal > 0 ? `${Math.round((run.filesSeen / run.filesTotal) * 100)}%` : "counting";
    process.stdout.write(
      `\r  ${percent}  ${run.filesSeen}/${run.filesTotal || "?"}  ${truncate(run.currentPath, 60)}   `,
    );
  }, 500);

  try {
    const summary = await scanLibrary(
      {
        musicRepo: deps.musicRepo,
        fileStore: deps.musicFileStore,
        metadataReader: deps.musicMetadataReader,
      },
      {
        folder,
        extensions,
        skipUnstreamable: !includeUnplayable,
        limit,
        pruneMissing: !noPrune,
      },
    );

    clearInterval(timer);
    process.stdout.write("\r" + " ".repeat(100) + "\r");

    const elapsed = (Date.now() - started) / 1000;
    console.log(`Status:      ${summary.status}`);
    console.log(`Files seen:  ${summary.filesSeen} of ${summary.filesTotal}`);
    console.log(`Added:       ${summary.tracksAdded}`);
    console.log(`Updated:     ${summary.tracksUpdated}`);
    console.log(`Skipped:     ${summary.filesSkipped} (unchanged since the last scan)`);
    console.log(`Failed:      ${summary.filesFailed}`);
    if (summary.tracksRemoved > 0) {
      console.log(`Removed:     ${summary.tracksRemoved} catalog rows for files no longer on disk`);
    }
    console.log(`Elapsed:     ${elapsed.toFixed(1)}s`);
    if (summary.filesSeen > 0) {
      const rate = summary.filesSeen / Math.max(elapsed, 0.001);
      console.log(`Rate:        ${rate.toFixed(1)} files/sec`);
      if (limit !== undefined) {
        console.log(
          `At that rate a full 20,000-file scan would take about ${Math.round(20000 / rate / 60)} minutes.`,
        );
      }
    }
    if (summary.lastError !== "") console.log(`Last error:  ${summary.lastError}`);
    console.log(`\nTracks in catalog: ${deps.musicRepo.countTracks()}`);

    if (summary.status === "failed") process.exitCode = 1;
  } catch (error) {
    clearInterval(timer);
    console.error(`\nScan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

/**
 * Lists what is in the catalog.
 *
 * Usage: npm run cli -- music-library [--search term] [--limit N] [--unplayable]
 */
export async function musicLibraryCommand(args: string[]): Promise<void> {
  const search = valueOf(args, "--search");
  const limit = Number(valueOf(args, "--limit") ?? "20");
  const unplayableOnly = args.includes("--unplayable");

  const total = deps.musicRepo.countTracks();
  console.log(`Tracks in catalog: ${total}`);

  const lyricCounts = deps.musicRepo.countLyricsByStatus();
  console.log(
    `Lyrics cached: ${lyricCounts.found} found, ${lyricCounts.instrumental} instrumental, ` +
      `${lyricCounts.not_found} not found, ${lyricCounts.failed} failed`,
  );

  const albums = deps.musicRepo.listAlbums({ limit: 5, offset: 0 });
  console.log(`Albums: ${albums.totalCount}`);
  console.log("");

  const { tracks, totalCount } = deps.musicRepo.searchTracks({
    search,
    streamableOnly: false,
    limit: Number.isInteger(limit) && limit > 0 ? limit : 20,
    offset: 0,
  });

  const shown = unplayableOnly ? tracks.filter((track) => !track.isStreamable) : tracks;
  console.log(`Showing ${shown.length} of ${totalCount}${search ? ` matching "${search}"` : ""}:`);
  for (const track of shown) {
    const flag = track.isStreamable ? " " : "!";
    const duration =
      track.durationSeconds === undefined
        ? "    "
        : `${Math.floor(track.durationSeconds / 60)}:${String(track.durationSeconds % 60).padStart(2, "0")}`;
    console.log(
      `${flag} ${duration}  ${track.extension.padEnd(4)}  ${track.displayTitle} - ${track.artist || "?"}`,
    );
  }
  if (shown.some((track) => !track.isStreamable)) {
    console.log("\n! = catalogued but no browser can play this format (APE, WMA).");
  }
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `...${value.slice(-(length - 3))}`;
}
