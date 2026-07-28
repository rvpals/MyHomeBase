import { describe, expect, it } from "vitest";
import {
  createEntry,
  deleteCategory,
  deleteEntry,
  deleteTag,
  getEntry,
  listCategories,
  listEntries,
  listTags,
  setLocked,
  setPinned,
  updateEntry,
  upsertCategory,
} from "./journal";
import type { JournalRepository } from "./ports";
import type { EntryWriteData } from "./schema";
import type { EntryLocation, JournalCategory, JournalEntry, JournalTag } from "./types";

// Hand-written in-memory fake. It models the managed category/tag lists and the
// entry<->name pairings (as the arrays on each entry) so the auto-register rule
// and the delete-detaches-pairings rule can be asserted without a database.
function fakeRepo(): JournalRepository {
  let entries: JournalEntry[] = [];
  let categories: JournalCategory[] = [];
  let tags: JournalTag[] = [];
  let nextEntryId = 1;
  let nextLocationId = 1;
  const now = "2026-01-01T00:00:00.000Z";

  function toLocations(entryId: number, inputs: EntryWriteData["locations"]): EntryLocation[] {
    return inputs.map((location, index) => ({
      id: nextLocationId++,
      entryId,
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: location.locationName,
      sortOrder: index,
    }));
  }

  function assemble(id: number, input: EntryWriteData): JournalEntry {
    return {
      id,
      date: input.date,
      time: input.time,
      title: input.title,
      content: input.content,
      placeName: input.placeName,
      weather: input.weather,
      isPinned: input.isPinned,
      isLocked: input.isLocked,
      categories: [...input.categories],
      tags: [...input.tags],
      locations: toLocations(id, input.locations),
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    listEntries() {
      return [...entries];
    },
    getEntryById(id) {
      return entries.find((entry) => entry.id === id);
    },
    createEntry(input) {
      const entry = assemble(nextEntryId++, input);
      entries.push(entry);
      return entry;
    },
    updateEntry(id, input) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`Entry ${id} not found.`);
      const updated = { ...assemble(id, input), createdAt: existing.createdAt };
      entries = entries.map((entry) => (entry.id === id ? updated : entry));
      return updated;
    },
    deleteEntry(id) {
      entries = entries.filter((entry) => entry.id !== id);
    },
    setEntryPinned(id, isPinned) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`Entry ${id} not found.`);
      existing.isPinned = isPinned;
      return existing;
    },
    setEntryLocked(id, isLocked) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`Entry ${id} not found.`);
      existing.isLocked = isLocked;
      return existing;
    },
    listCategories() {
      return [...categories];
    },
    getCategoryByName(name) {
      return categories.find((category) => category.name === name);
    },
    upsertCategory(input) {
      const existing = categories.find((category) => category.name === input.name);
      if (existing) {
        existing.description = input.description;
        return existing;
      }
      const created: JournalCategory = {
        name: input.name,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      };
      categories.push(created);
      return created;
    },
    deleteCategory(name) {
      categories = categories.filter((category) => category.name !== name);
      entries = entries.map((entry) => ({
        ...entry,
        categories: entry.categories.filter((category) => category !== name),
      }));
    },
    listTags() {
      return [...tags];
    },
    getTagByName(name) {
      return tags.find((tag) => tag.name === name);
    },
    upsertTag(input) {
      const existing = tags.find((tag) => tag.name === input.name);
      if (existing) {
        existing.description = input.description;
        return existing;
      }
      const created: JournalTag = {
        name: input.name,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      };
      tags.push(created);
      return created;
    },
    deleteTag(name) {
      tags = tags.filter((tag) => tag.name !== name);
      entries = entries.map((entry) => ({
        ...entry,
        tags: entry.tags.filter((tag) => tag !== name),
      }));
    },
    registerCategoriesIfMissing(names) {
      for (const name of names) {
        if (!categories.some((category) => category.name === name)) {
          categories.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
    registerTagsIfMissing(names) {
      for (const name of names) {
        if (!tags.some((tag) => tag.name === name)) {
          tags.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
  };
}

const minimalEntry = { date: "2026-07-27" };

describe("createEntry", () => {
  it("creates an entry with defaults applied", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, minimalEntry);
    expect(entry.id).toBe(1);
    expect(entry.title).toBe("");
    expect(entry.isPinned).toBe(false);
    expect(listEntries(repo)).toHaveLength(1);
  });

  it("allows multiple entries on the same date", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-07-27", time: "09:00" });
    createEntry(repo, { date: "2026-07-27", time: "18:30" });
    expect(listEntries(repo)).toHaveLength(2);
  });

  it("trims, drops blanks, and de-duplicates categories and tags", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, {
      date: "2026-07-27",
      categories: [" Work ", "Work", "Travel", ""],
      tags: ["daily", "daily", " personal "],
    });
    expect(entry.categories).toEqual(["Work", "Travel"]);
    expect(entry.tags).toEqual(["daily", "personal"]);
  });

  it("auto-registers referenced categories and tags into the managed lists", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-07-27", categories: ["Travel"], tags: ["trip"] });
    expect(listCategories(repo).map((category) => category.name)).toContain("Travel");
    expect(listTags(repo).map((tag) => tag.name)).toContain("trip");
  });

  it("does not overwrite an existing category's description when auto-registering", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Work", description: "Job stuff" });
    createEntry(repo, { date: "2026-07-27", categories: ["Work"] });
    expect(repo.getCategoryByName("Work")?.description).toBe("Job stuff");
  });

  it("stores parsed GPS locations with a preserved order and optional name", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, {
      date: "2026-07-27",
      locations: [
        { latitude: 12.34, longitude: -23.34, locationName: "pizza hut" },
        { latitude: 40.71, longitude: -74.0 },
      ],
    });
    expect(entry.locations).toHaveLength(2);
    expect(entry.locations[0]).toMatchObject({ locationName: "pizza hut", sortOrder: 0 });
    expect(entry.locations[1]).toMatchObject({ locationName: "", sortOrder: 1 });
  });

  it("keeps weather as an optional object", () => {
    const repo = fakeRepo();
    const withWeather = createEntry(repo, {
      date: "2026-07-27",
      weather: { temp: 21, unit: "C", description: "Sunny", code: 800 },
    });
    expect(withWeather.weather?.temp).toBe(21);
    const withoutWeather = createEntry(repo, { date: "2026-07-28" });
    expect(withoutWeather.weather).toBeUndefined();
  });

  it("rejects a badly formatted date", () => {
    const repo = fakeRepo();
    expect(() => createEntry(repo, { date: "July 27, 2026" })).toThrow();
  });
});

describe("updateEntry", () => {
  it("replaces the entry's contents", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27", title: "First" });
    const updated = updateEntry(repo, created.id, { date: "2026-07-27", title: "Edited" });
    expect(updated.title).toBe("Edited");
  });

  it("refuses to edit a locked entry", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27", isLocked: true });
    expect(() => updateEntry(repo, created.id, { date: "2026-07-27", title: "x" })).toThrow(/locked/);
  });

  it("allows editing again once unlocked", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27", isLocked: true });
    setLocked(repo, created.id, false);
    const updated = updateEntry(repo, created.id, { date: "2026-07-27", title: "now editable" });
    expect(updated.title).toBe("now editable");
  });

  it("rejects an unknown id", () => {
    const repo = fakeRepo();
    expect(() => updateEntry(repo, 999, { date: "2026-07-27" })).toThrow();
  });
});

describe("deleteEntry", () => {
  it("removes the entry", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27" });
    deleteEntry(repo, created.id);
    expect(listEntries(repo)).toHaveLength(0);
  });

  it("refuses to delete a locked entry", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27", isLocked: true });
    expect(() => deleteEntry(repo, created.id)).toThrow(/locked/);
  });
});

describe("setPinned and setLocked", () => {
  it("pins and unpins an entry", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-07-27" });
    expect(setPinned(repo, created.id, true).isPinned).toBe(true);
    expect(setPinned(repo, created.id, false).isPinned).toBe(false);
  });

  it("throws when pinning a missing entry", () => {
    const repo = fakeRepo();
    expect(() => setPinned(repo, 42, true)).toThrow();
  });
});

describe("category management", () => {
  it("upserts (creates then updates) a category", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Work", description: "first" });
    upsertCategory(repo, { name: "Work", description: "second" });
    expect(listCategories(repo)).toHaveLength(1);
    expect(repo.getCategoryByName("Work")?.description).toBe("second");
  });

  it("rejects an empty category name", () => {
    const repo = fakeRepo();
    expect(() => upsertCategory(repo, { name: "", description: "" })).toThrow();
  });

  it("detaches the category from entries when deleted", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, { date: "2026-07-27", categories: ["Work", "Travel"] });
    deleteCategory(repo, "Work");
    expect(listCategories(repo).map((category) => category.name)).not.toContain("Work");
    expect(getEntry(repo, entry.id)?.categories).toEqual(["Travel"]);
  });
});

describe("tag management", () => {
  it("detaches the tag from entries when deleted", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, { date: "2026-07-27", tags: ["daily", "personal"] });
    deleteTag(repo, "daily");
    expect(listTags(repo).map((tag) => tag.name)).not.toContain("daily");
    expect(getEntry(repo, entry.id)?.tags).toEqual(["personal"]);
  });
});
