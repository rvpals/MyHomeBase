import type { Track } from "@/lib/music";
import { shuffle, type RandomSource } from "@/lib/shared/random";
import type { GeneratedPlaylist, MagicGenerationStats } from "./types";

// The selection algorithm. Pure: takes candidates and a target, returns an ordered set.
// No SQL, no clock, no randomness of its own -- the rng arrives as a parameter, which is
// what makes every case below testable deterministically.

// `shuffle` moved to @/lib/shared/random when the play queue became its second caller
// (a player must not import from the Magic Playlist module). Re-exported from this file's
// barrel so every existing importer is unaffected.

/** A track's contribution to the running time. Candidates always have one -- see the port. */
function durationOf(track: Track): number {
  return track.durationSeconds ?? 0;
}

/**
 * What makes two tracks feel like "more of the same".
 *
 * Artist rather than album, and NOCASE to match how the catalog groups things: three
 * tracks in a row by one artist reads as clumping whether or not they came off the same
 * record, and an album is almost always one artist anyway. An untagged artist ('') is
 * deliberately NOT treated as a group -- in a library this untidy the untagged pile is
 * large and unrelated, so spacing it apart would be spacing apart strangers.
 */
function groupKeyOf(track: Track): string | undefined {
  const artist = track.artist.trim().toLowerCase();
  return artist === "" ? undefined : artist;
}

/**
 * Reorders a selected set so the same artist does not land back-to-back.
 *
 * A SEPARATE PASS from selection, and that separation is the point: selection decides
 * *which* tracks and has to respect a time target, while this decides *order* and cannot
 * change the running time at all. Folding the two together would mean a spacing rule that
 * could silently drop a track and miss the target.
 *
 * The method is a greedy pass over the shuffled order: walk it, and whenever the next
 * track repeats the previous track's artist, look ahead for the first one that does not
 * and take that instead. The displaced track stays in the queue and gets picked up on a
 * later step, so nothing is lost or duplicated -- this is a permutation, which the test
 * asserts.
 *
 * Deliberately NOT a full interleave (the usual "bucket by artist, round-robin the
 * buckets" trick). That produces a strict A-B-A-B rotation, which is its own kind of
 * unnatural -- predictable in a way a shuffle should not be -- and it fights the target
 * fill for no benefit. Greedy look-ahead removes the clumping people actually notice
 * while leaving the order random everywhere else.
 *
 * Where a playlist is mostly one artist, adjacency is unavoidable: ten Michael Jackson
 * tracks cannot be spaced apart within ten slots. The look-ahead simply finds nothing and
 * keeps the shuffled order, so a single-artist playlist still works and is still random.
 */
export function spaceOutTracks(tracks: readonly Track[], lookAhead = 3): Track[] {
  const remaining = [...tracks];
  const ordered: Track[] = [];
  let previousKey: string | undefined = undefined;

  while (remaining.length > 0) {
    // The first candidate whose artist differs from the one just placed. Bounded by
    // `lookAhead` so this stays O(n * k) rather than quadratic on a long playlist, and so
    // the order stays mostly the shuffle's -- reaching arbitrarily far ahead to avoid one
    // repeat would amount to re-sorting the list by artist.
    let chosenIndex = 0;
    if (previousKey !== undefined) {
      const limit = Math.min(remaining.length, lookAhead + 1);
      for (let index = 0; index < limit; index += 1) {
        const candidate = remaining[index] as Track;
        if (groupKeyOf(candidate) !== previousKey) {
          chosenIndex = index;
          break;
        }
      }
    }

    const [chosen] = remaining.splice(chosenIndex, 1);
    if (chosen === undefined) break;
    ordered.push(chosen);
    previousKey = groupKeyOf(chosen);
  }

  return ordered;
}

/**
 * Picks tracks from `candidates` to fill `targetSeconds`, approximately.
 *
 * The shape of the problem: this is a subset-sum, and solving it exactly would be both
 * expensive and WRONG for the purpose -- an exact fit would defeat the randomness, since
 * only a few combinations hit a given total and the "random" playlist would be the same
 * few every time. Approximate is what was asked for, and approximate is also what keeps
 * it varied.
 *
 * So: shuffle everything, then walk the shuffled order accumulating tracks. The only
 * decision is where to stop, and it is made on the LAST track rather than by a fixed
 * rule -- take it when doing so lands closer to the target than stopping short does.
 * That is what makes the result land within about half a track either side of the target
 * instead of always undershooting, which a plain `while (total < target)` would do.
 *
 * Walking on past a track that would overshoot badly (rather than stopping at the first
 * one) is deliberate: near the target a 12-minute live cut gets skipped while a 3-minute
 * song still fits, which fills the tail of the playlist more tightly than stopping dead
 * would. The walk visits each candidate at most once, so this stays O(n) and cannot
 * reorder its way into repeating a track.
 *
 * The returned tracks are then run through `spaceOutTracks`, which only permutes them --
 * the set, the count and the running time are all decided here and cannot be changed by
 * the ordering pass.
 */
export function selectTracksForTarget(
  candidates: readonly Track[],
  targetSeconds: number,
  random: RandomSource,
): GeneratedPlaylist {
  const shuffled = shuffle(candidates, random);
  const selected: Track[] = [];
  let totalSeconds = 0;

  for (const track of shuffled) {
    if (totalSeconds >= targetSeconds) break;

    const duration = durationOf(track);
    // A zero or negative duration would let the loop add tracks forever without moving
    // the total. The port promises a real duration, but this is the function that would
    // hang if that promise were ever broken, so it refuses rather than trusts.
    if (duration <= 0) continue;

    const withTrack = totalSeconds + duration;
    if (withTrack <= targetSeconds) {
      selected.push(track);
      totalSeconds = withTrack;
      continue;
    }

    // Overshooting. Take it only when the overshoot is smaller than the shortfall of
    // stopping here -- i.e. when this track's midpoint has not yet passed the target.
    const overshoot = withTrack - targetSeconds;
    const shortfall = targetSeconds - totalSeconds;
    if (overshoot < shortfall) {
      selected.push(track);
      totalSeconds = withTrack;
      break;
    }
    // Otherwise skip it and keep looking for something that fits the remaining gap.
  }

  // Spacing runs on the SELECTED set, after the target is met. It is a permutation, so the
  // running time and the stats below are unaffected by it -- which is why the stats are
  // built from `selected` and read the same either way.
  return {
    tracks: spaceOutTracks(selected),
    stats: buildStats(candidates.length, selected, totalSeconds, targetSeconds),
  };
}

/**
 * The explanation that ships with a result.
 *
 * `exhaustedCandidates` is the one flag the UI genuinely needs to change its wording:
 * "18 tracks, 52 min" reads as success, but if that was every matching track in the
 * library then the honest message is "that is all there was", not "here is your hour".
 */
function buildStats(
  candidateCount: number,
  selected: readonly Track[],
  totalSeconds: number,
  targetSeconds: number,
): MagicGenerationStats {
  return {
    candidateCount,
    selectedCount: selected.length,
    totalSeconds,
    targetSeconds,
    deltaSeconds: totalSeconds - targetSeconds,
    // `candidateCount > 0` is load-bearing: with no candidates at all, `0 === 0` would
    // otherwise report the library as "exhausted", which is a different story from
    // "nothing matched" and would have the UI say "that is all there was" about a set
    // that never existed.
    exhaustedCandidates:
      candidateCount > 0 && selected.length === candidateCount && totalSeconds < targetSeconds,
  };
}

/**
 * A human sentence describing how a generation went.
 *
 * In the library rather than the view so the CLI and the web app say the same thing --
 * and because deciding WHICH story a result tells (short because nothing matched, short
 * because the library ran out, or fine) is a judgement about the domain, not formatting.
 */
export function describeGeneration(stats: MagicGenerationStats): string {
  if (stats.candidateCount === 0) {
    return "Nothing in the library matches those criteria. Try removing one, or switch to matching any criteria.";
  }
  if (stats.selectedCount === 0) {
    return `${stats.candidateCount} tracks matched, but every one is longer than the target. Try a longer playlist.`;
  }
  if (stats.exhaustedCandidates) {
    return `Only ${stats.candidateCount} tracks matched, so this is all of them — shorter than asked for.`;
  }

  const drift = Math.abs(stats.deltaSeconds);
  const direction = stats.deltaSeconds >= 0 ? "over" : "under";
  const minutes = Math.round(drift / 60);
  if (minutes === 0) return `${stats.selectedCount} tracks, right on the target.`;
  return `${stats.selectedCount} tracks, ${minutes} min ${direction} the target.`;
}
