import { describe, expect, it } from "vitest";
import { cloneSeedFromEntry } from "./clone";
import type { EntryLocation, JournalEntry } from "./types";

function entry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  return {
    date: "2026-01-01",
    time: "",
    title: "Untitled",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-01-01 08:00:00",
    updatedAt: "2026-01-01 08:00:00",
    ...overrides,
  };
}

function location(overrides: Partial<EntryLocation> & { id: number }): EntryLocation {
  return {
    entryId: 1,
    latitude: 40.35,
    longitude: -74.65,
    locationName: "Princeton",
    sortOrder: 0,
    ...overrides,
  };
}

describe("cloneSeedFromEntry", () => {
  it("carries the fields that say what kind of event this is", () => {
    const seed = cloneSeedFromEntry(
      entry({
        id: 42,
        title: "AG3 swimming practice",
        placeName: "Princeton Tiger Aquatics",
        categories: ["FAMILY", "SPORT"],
        tags: ["swimming", "ag3"],
      }),
    );

    expect(seed).toEqual({
      sourceEntryId: 42,
      title: "AG3 swimming practice",
      placeName: "Princeton Tiger Aquatics",
      categories: ["FAMILY", "SPORT"],
      tags: ["swimming", "ag3"],
      locations: [],
    });
  });

  it("drops the date, time and content — the whole point of a clone", () => {
    const seed = cloneSeedFromEntry(
      entry({
        id: 7,
        date: "2026-03-14",
        time: "17:30:00",
        content: "Swam four sets of 100m and was wrecked afterwards.",
      }),
    );

    // Not "they are blank" but "they are absent from the shape": the form
    // stamps its own clock, and a seed that carried a date would quietly file
    // the new entry under the old day.
    expect(seed).not.toHaveProperty("date");
    expect(seed).not.toHaveProperty("time");
    expect(seed).not.toHaveProperty("content");
  });

  it("drops weather, pinned, locked and every identity field", () => {
    const seed = cloneSeedFromEntry(
      entry({
        id: 9,
        isPinned: true,
        isLocked: true,
        source: "ics",
        externalId: "abc-123@calendar",
        weather: { temp: 18, unit: "C", description: "Clear", code: 0 },
      }),
    );

    expect(seed).not.toHaveProperty("weather");
    expect(seed).not.toHaveProperty("isPinned");
    expect(seed).not.toHaveProperty("isLocked");
    expect(seed).not.toHaveProperty("source");
    expect(seed).not.toHaveProperty("externalId");
    // `sourceEntryId` is the one thing naming the original, and it exists only
    // so the New Entry screen can say what it was cloned from.
    expect(seed.sourceEntryId).toBe(9);
  });

  it("strips row identity from each pin but keeps the saved-place pointer", () => {
    const seed = cloneSeedFromEntry(
      entry({
        id: 3,
        locations: [
          location({
            id: 11,
            entryId: 3,
            sortOrder: 0,
            locationName: "Community Park Pool",
            streetAddress: "1 Pool Lane, Princeton NJ",
            savedLocationId: 55,
          }),
        ],
      }),
    );

    expect(seed.locations).toEqual([
      {
        latitude: 40.35,
        longitude: -74.65,
        locationName: "Community Park Pool",
        streetAddress: "1 Pool Lane, Princeton NJ",
        savedLocationId: 55,
      },
    ]);
  });

  it("omits the optional pin fields entirely when the source has none", () => {
    const seed = cloneSeedFromEntry(entry({ id: 4, locations: [location({ id: 12 })] }));

    // An absent key, not `undefined`: the seed has to match what the location
    // picker would have produced for a pin dropped by hand.
    expect(seed.locations[0]).not.toHaveProperty("streetAddress");
    expect(seed.locations[0]).not.toHaveProperty("savedLocationId");
  });

  it("copies the arrays rather than aliasing the source's", () => {
    const source = entry({ id: 5, categories: ["FAMILY"], tags: ["swimming"] });
    const seed = cloneSeedFromEntry(source);

    seed.categories.push("ADDED ON THE FORM");
    seed.tags.push("added");

    // The viewer is still rendering `source` behind the form. Mutating the seed
    // must not reach it.
    expect(source.categories).toEqual(["FAMILY"]);
    expect(source.tags).toEqual(["swimming"]);
  });

  it("seeds a blank title from a sealed entry, never the ciphertext", () => {
    const seed = cloneSeedFromEntry(
      entry({
        id: 6,
        isEncrypted: true,
        title: "",
        titleEncrypted: "v1:salt:iv:tag:ciphertext",
        content: "",
        contentEncrypted: "v1:salt:iv:tag:ciphertext",
        categories: ["PRIVATE"],
      }),
    );

    expect(seed.title).toBe("");
    // The shape still comes across — that is what makes cloning a sealed entry
    // worth offering at all once it has been unlocked.
    expect(seed.categories).toEqual(["PRIVATE"]);
    expect(JSON.stringify(seed)).not.toContain("ciphertext");
  });

  it("seeds the real headline once the caller has spliced in decrypted text", () => {
    // What the entry screen hands over after an unlock: `isEncrypted` is still
    // true, but `title` holds the opened text.
    const seed = cloneSeedFromEntry(
      entry({ id: 8, isEncrypted: true, title: "Therapy session", titleEncrypted: "v1:…" }),
    );

    expect(seed.title).toBe("Therapy session");
  });
});
