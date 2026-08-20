// Drives the play queue from the terminal.
//
// The same use-cases the Queue screen drives, with argv instead of buttons -- the litmus
// test in ARCHITECTURE.md. Nothing in src/lib/music changed to add this command.
//
// It cannot make a sound, of course: the <audio> element is in the browser. What it does
// is read and change the stored queue, which is the whole of the queue's state since
// migrations/0059 -- so `--next` here really does move the cursor, and the web player
// picks that up on its next read.
//
// Usage:
//   npm run cli -- play-queue                          # show the queue
//   npm run cli -- play-queue --add 123 [--add 456]     # append tracks
//   npm run cli -- play-queue --set 123 [--set 456]     # replace the queue
//   npm run cli -- play-queue --play <entryId>          # jump to an entry
//   npm run cli -- play-queue --next [--auto]           # advance (--auto = as if a track ended)
//   npm run cli -- play-queue --previous
//   npm run cli -- play-queue --shuffle
//   npm run cli -- play-queue --remove <entryId>
//   npm run cli -- play-queue --repeat off|all|one
//   npm run cli -- play-queue --clear

import {
  REPEAT_MODE_INFO,
  advanceQueue,
  clearQueue,
  enqueueTracks,
  getPlayQueue,
  isRepeatMode,
  playQueueEntry,
  queueDurationSeconds,
  remainingDurationSeconds,
  removeQueueEntry,
  rewindQueue,
  setQueue,
  setRepeatMode,
  shuffleQueue,
  type PlayQueue,
  type QueueDependencies,
} from "@/lib/music";
import { deps } from "@/lib/wiring";

/** Math.random injected here, not defaulted in the library -- same as the web adapter. */
function queueDeps(): QueueDependencies {
  return { musicRepo: deps.musicRepo, random: Math.random };
}

export async function playQueueCommand(args: string[]): Promise<void> {
  const dependencies = queueDeps();

  try {
    // Each flag is a different verb and they do not combine, so the first match wins.
    const setIds = valuesOf(args, "--set");
    if (setIds.length > 0) {
      print(setQueue({ trackIds: setIds.map(requireId) }, dependencies));
      return;
    }

    const addIds = valuesOf(args, "--add");
    if (addIds.length > 0) {
      print(enqueueTracks({ trackIds: addIds.map(requireId) }, dependencies));
      return;
    }

    const playId = valueOf(args, "--play");
    if (playId !== undefined) {
      print(playQueueEntry({ entryId: requireId(playId) }, dependencies));
      return;
    }

    const removeId = valueOf(args, "--remove");
    if (removeId !== undefined) {
      print(removeQueueEntry({ entryId: requireId(removeId) }, dependencies));
      return;
    }

    const repeat = valueOf(args, "--repeat");
    if (repeat !== undefined) {
      if (!isRepeatMode(repeat)) {
        throw new Error(
          `Unknown repeat mode "${repeat}". Use one of: off, all, one.`,
        );
      }
      print(setRepeatMode({ repeatMode: repeat }, dependencies));
      return;
    }

    if (args.includes("--next")) {
      // `--auto` reproduces a track ending rather than the Next button, which differ
      // under repeat-one. Worth exposing: it is the case a test would want to drive.
      const result = advanceQueue({ isManual: !args.includes("--auto") }, dependencies);
      if (result.playing === undefined) {
        console.log("The queue has run out. Nothing else to play.");
      }
      print(result.queue);
      return;
    }

    if (args.includes("--previous")) {
      print(rewindQueue(dependencies).queue);
      return;
    }

    if (args.includes("--shuffle")) {
      print(shuffleQueue(dependencies));
      return;
    }

    if (args.includes("--clear")) {
      print(clearQueue(dependencies));
      return;
    }

    print(getPlayQueue(dependencies));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/** The queue as a table, with the playing row marked. */
function print(queue: PlayQueue): void {
  if (queue.items.length === 0) {
    console.log("The queue is empty.");
    return;
  }

  const total = queueDurationSeconds(queue.items);
  const remaining = remainingDurationSeconds(queue.items, queue.state);

  console.log("");
  for (const [index, item] of queue.items.entries()) {
    const isCurrent = item.entry.id === queue.state.currentEntryId;
    const marker = isCurrent ? ">" : " ";
    const position = String(index + 1).padStart(3);
    const entryId = String(item.entry.id).padStart(6);
    const duration = formatClock(item.track.durationSeconds ?? 0).padStart(6);
    const artist = item.track.artist === "" ? "Unknown artist" : item.track.artist;
    console.log(
      `${marker} ${position}  entry ${entryId}  ${duration}  ${item.track.displayTitle} — ${artist}`,
    );
  }

  console.log("");
  console.log(
    `${queue.items.length} tracks, ${formatClock(total)} total, ${formatClock(remaining)} still to play.`,
  );
  console.log(
    `Repeat: ${REPEAT_MODE_INFO[queue.state.repeatMode].label}${
      queue.state.isShuffled ? " — shuffled" : ""
    }`,
  );
}

/** h:mm:ss for a queue length, which is usually longer than the mm:ss the UI shows. */
function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(remainder)}`
    : `${minutes}:${pad(remainder)}`;
}

/** The value following a flag, or undefined when it is absent. */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

/** Every value for a REPEATED flag -- how a list arrives on a command line. */
function valuesOf(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg !== flag) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.`);
    }
    values.push(value);
  }
  return values;
}

function requireId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`"${raw}" is not a valid id.`);
  }
  return id;
}
