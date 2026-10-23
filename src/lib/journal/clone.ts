// Cloning one journal entry into the starting point for another.
//
// The reader has an entry for something that recurs — "AG3 swimming practice" —
// and wants the next one without re-picking the same categories, tags and pool.
// Clone copies the entry's *shape* onto a blank form and leaves the date, the
// time and the writing to be filled in fresh.
//
// This is a pure function over a `JournalEntry`, not a repository call, for the
// usual reason: the caller already has the entry (the viewer is rendering it,
// the CLI has just fetched it), so taking the row as an argument keeps this
// testable with a literal and keeps the one rule about *what a clone carries*
// in one place for the web form, the CLI and the test.
//
// Deliberately **not** the prefill-template path. A template is a saved, named
// set of values chosen from a dropdown, which fills only the fields you have
// left blank; a clone is taken from one specific entry you are looking at, and
// it *is* the form's starting point. The two answer different questions and the
// entry form takes them through different props — see `applyPrefillTemplate`.

import type {
  JournalEntry,
  JournalEntryCloneLocation,
  JournalEntryCloneSeed,
} from "./types";

/**
 * Builds the seed for a new entry from an existing one.
 *
 * What is carried and what is dropped is documented on `JournalEntryCloneSeed`,
 * which is the contract this function implements.
 *
 * **An encrypted entry carries no title.** When `isEncrypted` is true the entry's
 * `title` reads as `""` and the real text lives in the sealed column, so there is
 * nothing to copy unless the caller has already spliced the decrypted text in —
 * which the entry screen does once the reader has unlocked it. Either way this
 * function copies whatever `title` holds, so a sealed entry seeds a blank title
 * rather than the placeholder, and an opened one seeds the real headline. It
 * never reaches into the ciphertext itself, so a clone can never leak a title
 * that the caller could not already read.
 *
 * The seed is a fresh object every time and shares no array with the source, so
 * editing the form cannot mutate the entry the viewer is still showing.
 */
export function cloneSeedFromEntry(entry: JournalEntry): JournalEntryCloneSeed {
  return {
    sourceEntryId: entry.id,
    title: entry.title,
    placeName: entry.placeName,
    // Copied, not aliased: the form owns its own arrays and pushes into them.
    categories: [...entry.categories],
    tags: [...entry.tags],
    locations: entry.locations.map(cloneSeedLocation),
  };
}

/**
 * Strips one pin down to the fields a *new* entry can own.
 *
 * `id`, `entryId` and `sortOrder` identify the original's rows and are dropped:
 * the clone's pins are inserted fresh, in the order the form holds them. The
 * optional fields are only set when present so the seed matches what the entry
 * form's `JournalLocationInput` would have had if the pin were picked by hand —
 * an explicit `undefined` and an absent key are the same to the action, but not
 * to a test's `toEqual`.
 */
function cloneSeedLocation(location: JournalEntry["locations"][number]): JournalEntryCloneLocation {
  const seed: JournalEntryCloneLocation = {
    latitude: location.latitude,
    longitude: location.longitude,
    locationName: location.locationName,
  };
  if (location.streetAddress !== undefined) seed.streetAddress = location.streetAddress;
  if (location.savedLocationId !== undefined) seed.savedLocationId = location.savedLocationId;
  return seed;
}
