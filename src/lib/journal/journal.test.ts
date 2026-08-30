import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCategoryIcon,
  clearTagIcon,
  createEntry,
  deleteCategory,
  deleteEntry,
  deleteFilter,
  deleteTag,
  findEntries,
  generateMissingTaxonomyIcons,
  getCategoryIcon,
  getFilter,
  listFilters,
  saveFilter,
  getEntry,
  getEntryNeighbors,
  getTagIcon,
  listCategories,
  listEntries,
  listRecentEntries,
  searchEntries,
  listTags,
  listTodayInHistory,
  listTopCategories,
  listTopTags,
  setCategoryIcon,
  setLocked,
  setPinned,
  setTagIcon,
  updateEntry,
  upsertCategory,
  upsertTag,
} from "./journal";
import { emptyFilter } from "./filters";
import { MAX_JOURNAL_ICON_BYTES } from "./schema";
import type { JournalRepository } from "./ports";
import type { EntryWriteData } from "./schema";
import type {
  EntryLocation,
  JournalCategory,
  JournalEntry,
  JournalFilterCondition,
  JournalTag,
  JournalTaxonomyIcon,
  SavedJournalFilter,
} from "./types";

// Hand-written in-memory fake. It models the managed category/tag lists and the
// entry<->name pairings (as the arrays on each entry) so the auto-register rule
// and the delete-detaches-pairings rule can be asserted without a database.
function fakeRepo(): JournalRepository {
  let entries: JournalEntry[] = [];
  let categories: JournalCategory[] = [];
  let tags: JournalTag[] = [];
  const categoryIcons = new Map<string, JournalTaxonomyIcon>();
  const tagIcons = new Map<string, JournalTaxonomyIcon>();
  let savedFilters: SavedJournalFilter[] = [];
  let nextFilterId = 1;
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
    listRecentEntries(limit) {
      return [...entries]
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .slice(0, limit);
    },
    listEntriesByMonthDay(monthDay) {
      return entries
        .filter((entry) => entry.date.slice(5) === monthDay)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    listEntriesInDateRange(startDate, endDate) {
      return entries
        .filter((entry) => entry.date >= startDate && entry.date <= endDate)
        .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    },
    searchEntries(term, limit) {
      const needle = term.toLowerCase();
      return entries
        .filter(
          (entry) =>
            entry.date.toLowerCase().includes(needle) ||
            entry.time.toLowerCase().includes(needle) ||
            entry.title.toLowerCase().includes(needle) ||
            entry.content.toLowerCase().includes(needle) ||
            entry.placeName.toLowerCase().includes(needle) ||
            entry.categories.some((name) => name.toLowerCase().includes(needle)) ||
            entry.tags.some((name) => name.toLowerCase().includes(needle)),
        )
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .slice(0, limit);
    },
    // An in-memory stand-in for the compiled SQL. Only the operators the tests
    // below exercise are implemented — enough to prove the use-case's own rules
    // (limit validation, empty filter = everything). buildFilterSql's full
    // operator matrix is covered directly in filters.test.ts against the SQL it
    // emits, which is the thing that actually runs in production.
    findEntries(filter, limit) {
      const matchesCondition = (entry: JournalEntry, condition: JournalFilterCondition): boolean => {
        switch (condition.field) {
          case "title":
            return condition.operator === "contains"
              ? entry.title.toLowerCase().includes((condition.value ?? "").toLowerCase())
              : true;
          case "category":
            return condition.operator === "hasAny"
              ? entry.categories.some((name) => (condition.values ?? []).includes(name))
              : !entry.categories.some((name) => (condition.values ?? []).includes(name));
          case "isPinned":
            return entry.isPinned === (condition.value === "true");
          default:
            return true;
        }
      };
      const complete = (condition: JournalFilterCondition) =>
        condition.operator === "hasAny" || condition.operator === "hasNone"
          ? (condition.values ?? []).some((name) => name.trim() !== "")
          : (condition.value ?? "").trim() !== "";

      const groups = filter.groups
        .map((group) => ({ ...group, conditions: group.conditions.filter(complete) }))
        .filter((group) => group.conditions.length > 0);

      const matched = groups.length === 0
        ? [...entries]
        : entries.filter((entry) => {
            const groupResults = groups.map((group) =>
              group.join === "OR"
                ? group.conditions.some((condition) => matchesCondition(entry, condition))
                : group.conditions.every((condition) => matchesCondition(entry, condition)),
            );
            return filter.join === "OR" ? groupResults.some(Boolean) : groupResults.every(Boolean);
          });

      return matched
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .slice(0, limit);
    },
    listFilters() {
      return [...savedFilters].sort((a, b) => a.name.localeCompare(b.name));
    },
    getFilterById(id) {
      return savedFilters.find((saved) => saved.id === id);
    },
    saveFilter(input) {
      // Upsert by name, like the real UNIQUE (name) + ON CONFLICT.
      const existing = savedFilters.find((saved) => saved.name === input.name);
      if (existing) {
        existing.filter = input.filter;
        return existing;
      }
      const created = {
        id: nextFilterId++,
        name: input.name,
        filter: input.filter,
        createdAt: now,
        updatedAt: now,
      };
      savedFilters.push(created);
      return created;
    },
    deleteFilter(id) {
      savedFilters = savedFilters.filter((saved) => saved.id !== id);
    },
    getEntryById(id) {
      return entries.find((entry) => entry.id === id);
    },
    getEntryNeighbors(entryId) {
      // Mirrors the repository: order by (date, time, id) ascending, then take
      // the entries either side of the anchor.
      const ordered = [...entries].sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date)
        : a.time !== b.time ? a.time.localeCompare(b.time)
        : a.id - b.id,
      );
      const index = ordered.findIndex((entry) => entry.id === entryId);
      if (index === -1) return {};
      const toRef = (entry: JournalEntry) => ({ id: entry.id, date: entry.date, title: entry.title });
      return {
        previous: index > 0 ? toRef(ordered[index - 1]) : undefined,
        next: index < ordered.length - 1 ? toRef(ordered[index + 1]) : undefined,
      };
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
    countEntriesMatching: (key) =>
      entries.filter(
        (entry) =>
          entry.date === key.date &&
          entry.time === key.time &&
          entry.title.trim() === key.title.trim(),
      ).length,
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
    getCategoryIcon: (name) => categoryIcons.get(name),
    setCategoryIcon(name, icon) {
      if (icon) categoryIcons.set(name, icon);
      else categoryIcons.delete(name);
      const category = categories.find((candidate) => candidate.name === name);
      if (category) category.iconMimeType = icon?.mimeType;
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
    getTagIcon: (name) => tagIcons.get(name),
    setTagIcon(name, icon) {
      if (icon) tagIcons.set(name, icon);
      else tagIcons.delete(name);
      const tag = tags.find((candidate) => candidate.name === name);
      if (tag) tag.iconMimeType = icon?.mimeType;
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
    listTopTags(limit) {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, entryCount]) => ({ name, entryCount }))
        .sort((a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
    listTopCategories(limit) {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        for (const category of entry.categories) counts.set(category, (counts.get(category) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, entryCount]) => ({ name, entryCount }))
        .sort((a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
    // Prefill templates are exercised in prefill.test.ts, which brings its own
    // fake. These satisfy the port so this file keeps compiling; nothing here
    // asserts against them.
    listPrefillTemplates() {
      return [];
    },
    getPrefillTemplateById() {
      return undefined;
    },
    getPrefillTemplateByName() {
      return undefined;
    },
    savePrefillTemplate() {
      throw new Error("not used in these tests");
    },
    deletePrefillTemplate() {},
    setPrefillTemplateEnabled() {
      throw new Error("not used in these tests");
    },
    listDistinctFieldValues() {
      return [];
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

describe("listRecentEntries", () => {
  it("returns entries newest journal date first, limited to the requested count", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", title: "oldest" });
    createEntry(repo, { date: "2026-03-15", title: "newest" });
    createEntry(repo, { date: "2026-02-10", title: "middle" });

    const recent = listRecentEntries(repo, 2);
    expect(recent.map((entry) => entry.title)).toEqual(["newest", "middle"]);
  });

  it("rejects a non-positive limit", () => {
    expect(() => listRecentEntries(fakeRepo(), 0)).toThrow();
  });
});

describe("getEntryNeighbors", () => {
  it("returns the older entry as previous and the newer as next", () => {
    const repo = fakeRepo();
    const oldest = createEntry(repo, { date: "2026-01-01", title: "oldest" });
    const middle = createEntry(repo, { date: "2026-02-01", title: "middle" });
    const newest = createEntry(repo, { date: "2026-03-01", title: "newest" });

    const neighbors = getEntryNeighbors(repo, middle.id);

    expect(neighbors.previous?.id).toBe(oldest.id);
    expect(neighbors.next?.id).toBe(newest.id);
  });

  it("omits previous for the oldest entry and next for the newest", () => {
    const repo = fakeRepo();
    const oldest = createEntry(repo, { date: "2026-01-01" });
    const newest = createEntry(repo, { date: "2026-03-01" });

    expect(getEntryNeighbors(repo, oldest.id).previous).toBeUndefined();
    expect(getEntryNeighbors(repo, oldest.id).next?.id).toBe(newest.id);
    expect(getEntryNeighbors(repo, newest.id).next).toBeUndefined();
    expect(getEntryNeighbors(repo, newest.id).previous?.id).toBe(oldest.id);
  });

  it("breaks ties on the same date by time, then id", () => {
    const repo = fakeRepo();
    const morning = createEntry(repo, { date: "2026-05-05", time: "08:00:00" });
    const noonA = createEntry(repo, { date: "2026-05-05", time: "12:00:00" });
    const noonB = createEntry(repo, { date: "2026-05-05", time: "12:00:00" });

    // noonA and noonB share a timestamp, so id decides their order.
    expect(getEntryNeighbors(repo, noonA.id).previous?.id).toBe(morning.id);
    expect(getEntryNeighbors(repo, noonA.id).next?.id).toBe(noonB.id);
    expect(getEntryNeighbors(repo, noonB.id).previous?.id).toBe(noonA.id);
  });

  it("returns no neighbours for an unknown entry", () => {
    expect(getEntryNeighbors(fakeRepo(), 999)).toEqual({});
  });

  it("rejects a non-positive id", () => {
    expect(() => getEntryNeighbors(fakeRepo(), 0)).toThrow();
  });
});

describe("listTodayInHistory", () => {
  function seedDates(repo: ReturnType<typeof fakeRepo>, dates: string[]) {
    dates.forEach((date, index) => createEntry(repo, { date, title: `entry ${index}` }));
  }

  it("returns same month/day entries from earlier years with the years elapsed", () => {
    const repo = fakeRepo();
    seedDates(repo, ["2024-07-29", "2019-07-29", "2023-07-29"]);

    const result = listTodayInHistory(repo, "2026-07-29");

    expect(result.map((item) => item.yearsAgo)).toEqual([2, 3, 7]); // newest first
    expect(result.map((item) => item.entry.date)).toEqual(["2024-07-29", "2023-07-29", "2019-07-29"]);
  });

  it("excludes entries from the reference year itself", () => {
    const repo = fakeRepo();
    seedDates(repo, ["2026-07-29", "2020-07-29"]);

    const result = listTodayInHistory(repo, "2026-07-29");

    expect(result).toHaveLength(1);
    expect(result[0].yearsAgo).toBe(6);
  });

  it("excludes entries dated after the reference year", () => {
    const repo = fakeRepo();
    seedDates(repo, ["2030-07-29"]);
    expect(listTodayInHistory(repo, "2026-07-29")).toEqual([]);
  });

  it("ignores a different month or day", () => {
    const repo = fakeRepo();
    seedDates(repo, ["2020-07-28", "2020-08-29"]);
    expect(listTodayInHistory(repo, "2026-07-29")).toEqual([]);
  });

  it("matches only leap years for a Feb 29 reference date", () => {
    const repo = fakeRepo();
    seedDates(repo, ["2020-02-29", "2021-02-28"]);

    const result = listTodayInHistory(repo, "2024-02-29");

    expect(result).toHaveLength(1);
    expect(result[0].entry.date).toBe("2020-02-29");
    expect(result[0].yearsAgo).toBe(4);
  });

  it("rejects a malformed reference date", () => {
    expect(() => listTodayInHistory(fakeRepo(), "July 29, 2026")).toThrow();
  });
});

describe("searchEntries", () => {
  it("returns entries matching the term, newest journal date first", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-02-10", title: "Trips" });
    createEntry(repo, { date: "2026-05-01", title: "Recipe ideas" });
    createEntry(repo, { date: "2026-01-05", title: "Groceries" });

    const results = searchEntries(repo, "recipe");

    expect(results.map((entry) => entry.title)).toEqual(["Recipe ideas"]);
  });

  it("matches case-insensitively and across multiple exposed fields", () => {
    const repo = fakeRepo();
    createEntry(repo, {
      date: "2026-07-27",
      title: "Beach day",
      content: "We saw a dolphin near the shore.",
      tags: ["holiday"],
    });
    createEntry(repo, { date: "2026-06-30", title: "Shopping", content: "Groceries", categories: ["food"] });

    // content
    expect(searchEntries(repo, "DOLPHIN").map((e) => e.title)).toEqual(["Beach day"]);
    // tag
    expect(searchEntries(repo, "holiday").map((e) => e.title)).toEqual(["Beach day"]);
    // category
    expect(searchEntries(repo, "food").map((e) => e.title)).toEqual(["Shopping"]);
    // date
    expect(searchEntries(repo, "2026-07-27").map((e) => e.title)).toEqual(["Beach day"]);
  });

  it("returns nothing for a blank term rather than dumping the journal", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-07-27", title: "Anything" });
    expect(searchEntries(repo, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-07-27", title: "one", content: "shared" });
    createEntry(repo, { date: "2026-07-28", title: "two", content: "shared" });
    expect(searchEntries(repo, "shared", 1)).toHaveLength(1);
  });

  it("rejects a non-positive limit", () => {
    expect(() => searchEntries(fakeRepo(), "term", 0)).toThrow();
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

describe("findEntries", () => {
  it("returns every entry for an empty filter, unlike searchEntries' blank term", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", title: "one" });
    createEntry(repo, { date: "2026-01-02", title: "two" });

    // The Entries browser's "All entries" is an empty filter, so this must not
    // be the empty list that a blank search term returns.
    expect(findEntries(repo, emptyFilter())).toHaveLength(2);
    expect(searchEntries(repo, "")).toHaveLength(0);
  });

  it("applies a condition", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", title: "Rome trip" });
    createEntry(repo, { date: "2026-01-02", title: "groceries" });

    const result = findEntries(repo, {
      join: "AND",
      groups: [{ join: "AND", conditions: [{ field: "title", operator: "contains", value: "trip" }] }],
    });
    expect(result.map((entry) => entry.title)).toEqual(["Rome trip"]);
  });

  it("honours a group's OR against the filter's AND", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", title: "Rome", categories: ["Travel"] });
    createEntry(repo, { date: "2026-01-02", title: "Oslo", categories: ["Travel"] });
    createEntry(repo, { date: "2026-01-03", title: "Rome", categories: ["Work"] });

    // (title~Rome OR title~Oslo) AND category=Travel
    const result = findEntries(repo, {
      join: "AND",
      groups: [
        {
          join: "OR",
          conditions: [
            { field: "title", operator: "contains", value: "Rome" },
            { field: "title", operator: "contains", value: "Oslo" },
          ],
        },
        { join: "AND", conditions: [{ field: "category", operator: "hasAny", values: ["Travel"] }] },
      ],
    });
    expect(result.map((entry) => entry.title).sort()).toEqual(["Oslo", "Rome"]);
  });

  it("newest journal date first, capped at the limit", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", title: "old" });
    createEntry(repo, { date: "2026-03-01", title: "new" });

    expect(findEntries(repo, emptyFilter())[0].title).toBe("new");
    expect(findEntries(repo, emptyFilter(), 1)).toHaveLength(1);
  });

  it("rejects a non-positive limit", () => {
    const repo = fakeRepo();
    expect(() => findEntries(repo, emptyFilter(), 0)).toThrow(/positive integer/);
    expect(() => findEntries(repo, emptyFilter(), 1.5)).toThrow(/positive integer/);
  });
});

describe("saved filter management", () => {
  const filter = {
    join: "AND" as const,
    groups: [
      { join: "AND" as const, conditions: [{ field: "title" as const, operator: "contains" as const, value: "trip" }] },
    ],
  };

  it("saves and lists a named filter", () => {
    const repo = fakeRepo();
    saveFilter(repo, { name: "Trips", filter });
    expect(listFilters(repo).map((saved) => saved.name)).toEqual(["Trips"]);
  });

  it("overwrites by name rather than adding a duplicate", () => {
    const repo = fakeRepo();
    const first = saveFilter(repo, { name: "Trips", filter });
    const second = saveFilter(repo, {
      name: "Trips",
      filter: { join: "AND", groups: [{ join: "AND", conditions: [{ field: "title", operator: "contains", value: "changed" }] }] },
    });

    // UNIQUE (name) is what makes save an upsert — two same-named filters would
    // be indistinguishable in the dropdown.
    expect(listFilters(repo)).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(getFilter(repo, first.id)?.filter.groups[0].conditions[0].value).toBe("changed");
  });

  it("rejects a blank name", () => {
    const repo = fakeRepo();
    expect(() => saveFilter(repo, { name: "", filter })).toThrow();
    expect(() => saveFilter(repo, { name: "   ", filter })).not.toThrow(); // whitespace is a name; trimming is the UI's job
  });

  it("deletes a filter", () => {
    const repo = fakeRepo();
    const saved = saveFilter(repo, { name: "Trips", filter });
    deleteFilter(repo, saved.id);
    expect(listFilters(repo)).toHaveLength(0);
    expect(getFilter(repo, saved.id)).toBeUndefined();
  });
});

describe("category icons", () => {
  const tinyPngBase64 = Buffer.from("fake png bytes").toString("base64");

  it("stores an icon and records its mime type on the category", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Travel", description: "" });

    setCategoryIcon(repo, "Travel", { mimeType: "image/png", base64Data: tinyPngBase64 });

    expect(getCategoryIcon(repo, "Travel")?.mimeType).toBe("image/png");
    expect(repo.getCategoryByName("Travel")?.iconMimeType).toBe("image/png");
  });

  it("clears the icon again", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Travel", description: "" });
    setCategoryIcon(repo, "Travel", { mimeType: "image/png", base64Data: tinyPngBase64 });

    clearCategoryIcon(repo, "Travel");

    expect(getCategoryIcon(repo, "Travel")).toBeUndefined();
    expect(repo.getCategoryByName("Travel")?.iconMimeType).toBeUndefined();
  });

  it("rejects an icon over the size cap", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Travel", description: "" });
    const tooBig = Buffer.alloc(MAX_JOURNAL_ICON_BYTES + 1).toString("base64");

    expect(() =>
      setCategoryIcon(repo, "Travel", { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/);
  });

  it("refuses an icon for a category that doesn't exist", () => {
    const repo = fakeRepo();
    expect(() =>
      setCategoryIcon(repo, "Nope", { mimeType: "image/png", base64Data: tinyPngBase64 }),
    ).toThrow(/No category named/);
    expect(() => clearCategoryIcon(repo, "Nope")).toThrow(/No category named/);
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

describe("tag icons", () => {
  const tinyPngBase64 = Buffer.from("fake png bytes").toString("base64");

  it("stores an icon and records its mime type on the tag", () => {
    const repo = fakeRepo();
    upsertTag(repo, { name: "daily", description: "" });

    setTagIcon(repo, "daily", { mimeType: "image/png", base64Data: tinyPngBase64 });

    expect(getTagIcon(repo, "daily")?.mimeType).toBe("image/png");
    expect(repo.getTagByName("daily")?.iconMimeType).toBe("image/png");
  });

  it("clears the icon again", () => {
    const repo = fakeRepo();
    upsertTag(repo, { name: "daily", description: "" });
    setTagIcon(repo, "daily", { mimeType: "image/png", base64Data: tinyPngBase64 });

    clearTagIcon(repo, "daily");

    expect(getTagIcon(repo, "daily")).toBeUndefined();
    expect(repo.getTagByName("daily")?.iconMimeType).toBeUndefined();
  });

  it("refuses an icon for a tag that doesn't exist", () => {
    const repo = fakeRepo();
    expect(() =>
      setTagIcon(repo, "nope", { mimeType: "image/png", base64Data: tinyPngBase64 }),
    ).toThrow(/No tag named/);
    expect(() => clearTagIcon(repo, "nope")).toThrow(/No tag named/);
  });
});

describe("generateMissingTaxonomyIcons", () => {
  const tinyPngBase64 = Buffer.from("fake png bytes").toString("base64");

  // No network in a unit test: a failed fetch is the documented path to the
  // locally drawn glyph, so stubbing it out keeps the run offline and
  // deterministic without changing which branch is under test.
  function stubOfflineFetch() {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills in only the tags that have no icon when asked for tags", async () => {
    stubOfflineFetch();
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Travel", description: "" });
    upsertTag(repo, { name: "daily", description: "" });
    upsertTag(repo, { name: "hiking", description: "" });
    setTagIcon(repo, "daily", { mimeType: "image/png", base64Data: tinyPngBase64 });

    const summary = await generateMissingTaxonomyIcons(repo, "tag");

    expect(summary).toEqual({ generated: 1, failed: 0 });
    // The hand-uploaded icon is left exactly as it was...
    expect(getTagIcon(repo, "daily")?.mimeType).toBe("image/png");
    // ...the blank one is filled...
    expect(getTagIcon(repo, "hiking")?.mimeType).toBe("image/svg+xml");
    // ...and the category list is untouched by a tags-only run.
    expect(getCategoryIcon(repo, "Travel")).toBeUndefined();
  });

  it("covers both lists when no kind is given", async () => {
    stubOfflineFetch();
    const repo = fakeRepo();
    upsertCategory(repo, { name: "Travel", description: "" });
    upsertTag(repo, { name: "hiking", description: "" });

    const summary = await generateMissingTaxonomyIcons(repo);

    expect(summary).toEqual({ generated: 2, failed: 0 });
    expect(getCategoryIcon(repo, "Travel")?.mimeType).toBe("image/svg+xml");
    expect(getTagIcon(repo, "hiking")?.mimeType).toBe("image/svg+xml");
  });
});

describe("listTopTags", () => {
  it("returns the most-used tags, highest count first, limited to the requested count", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", tags: ["a", "b"] });
    createEntry(repo, { date: "2026-01-02", tags: ["a", "c"] });
    createEntry(repo, { date: "2026-01-03", tags: ["a"] });

    const top = listTopTags(repo, 2);
    expect(top).toEqual([
      { name: "a", entryCount: 3 },
      { name: "b", entryCount: 1 },
    ]);
  });

  it("defaults to a limit of 10", () => {
    const repo = fakeRepo();
    for (let i = 0; i < 12; i++) {
      createEntry(repo, { date: `2026-01-${String(i + 1).padStart(2, "0")}`, tags: [`tag${i}`] });
    }
    expect(listTopTags(repo)).toHaveLength(10);
  });

  it("rejects a non-positive limit", () => {
    expect(() => listTopTags(fakeRepo(), 0)).toThrow();
  });
});

describe("listTopCategories", () => {
  it("returns the most-used categories, highest count first, limited to the requested count", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-01-01", categories: ["Work", "Travel"] });
    createEntry(repo, { date: "2026-01-02", categories: ["Work"] });
    createEntry(repo, { date: "2026-01-03", categories: ["Work", "Travel"] });

    const top = listTopCategories(repo, 2);
    expect(top).toEqual([
      { name: "Work", entryCount: 3 },
      { name: "Travel", entryCount: 2 },
    ]);
  });

  it("defaults to a limit of 10", () => {
    const repo = fakeRepo();
    for (let i = 0; i < 12; i++) {
      createEntry(repo, { date: `2026-01-${String(i + 1).padStart(2, "0")}`, categories: [`cat${i}`] });
    }
    expect(listTopCategories(repo)).toHaveLength(10);
  });

  it("rejects a non-positive limit", () => {
    expect(() => listTopCategories(fakeRepo(), 0)).toThrow();
  });
});
