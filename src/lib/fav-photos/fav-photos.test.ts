import { describe, expect, it } from "vitest";
import {
  addFavPhoto,
  getFavPhoto,
  isFavPhoto,
  listFavPhotos,
  removeFavPhoto,
  setFavPhotoNote,
  toggleFavPhoto,
} from "./index";
import type { FavPhotoRepository } from "./ports";
import type { FavPhoto } from "./types";

const PATH = "2019/2019-06 June/IMG_20190609_143501.jpg";
const OTHER = "2021/2021-07-04 Fireworks/IMG_0002.jpg";

// Hand-written fake, matching the sibling modules' style. It mimics the three
// behaviours the real table guarantees: the path is the key (so `add` is idempotent
// and never overwrites a note), `list` comes back newest first, and `setNote` is an
// UPDATE that cannot create a row.
function fakeRepo(seed: FavPhoto[] = []): FavPhotoRepository {
  let rows = [...seed];
  let clock = seed.length;

  return {
    list() {
      return [...rows].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.relativePath.localeCompare(b.relativePath)
          : b.createdAt.localeCompare(a.createdAt),
      );
    },
    get(relativePath) {
      return rows.find((row) => row.relativePath === relativePath);
    },
    isFavorite(relativePath) {
      return rows.some((row) => row.relativePath === relativePath);
    },
    add(relativePath, note) {
      if (rows.some((row) => row.relativePath === relativePath)) return;
      clock += 1;
      rows.push({
        relativePath,
        note,
        createdAt: `2026-08-29T00:00:${String(clock).padStart(2, "0")}Z`,
      });
    },
    remove(relativePath) {
      rows = rows.filter((row) => row.relativePath !== relativePath);
    },
    setNote(relativePath, note) {
      rows = rows.map((row) => (row.relativePath === relativePath ? { ...row, note } : row));
    },
  };
}

describe("toggleFavPhoto", () => {
  it("stars a photo that isn't starred, and says so", () => {
    const repo = fakeRepo();

    expect(toggleFavPhoto(repo, PATH)).toBe(true);
    expect(repo.isFavorite(PATH)).toBe(true);
  });

  it("un-stars one that is, and says so", () => {
    const repo = fakeRepo();
    toggleFavPhoto(repo, PATH);

    expect(toggleFavPhoto(repo, PATH)).toBe(false);
    expect(repo.isFavorite(PATH)).toBe(false);
  });

  it("stores an empty note when the heart supplies none", () => {
    const repo = fakeRepo();
    toggleFavPhoto(repo, PATH);

    expect(repo.get(PATH)?.note).toBe("");
  });

  it("discards the note when a favourite is un-starred", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH, "The strawberry festival");

    toggleFavPhoto(repo, PATH);

    expect(repo.get(PATH)).toBeUndefined();
  });

  it("treats a backslash path as the same photo, so it can be un-starred", () => {
    const repo = fakeRepo();
    toggleFavPhoto(repo, PATH);

    // A Windows-shaped path for a photo already starred by its stored form must flip
    // the existing row off, not add a second one.
    expect(toggleFavPhoto(repo, PATH.replace(/\//g, "\\"))).toBe(false);
    expect(repo.list()).toHaveLength(0);
  });

  it("rejects a path that tries to escape the photo root", () => {
    const repo = fakeRepo();

    expect(() => toggleFavPhoto(repo, "../../etc/passwd")).toThrow();
    expect(repo.list()).toHaveLength(0);
  });

  it("rejects an absolute path", () => {
    const repo = fakeRepo();

    expect(() => toggleFavPhoto(repo, "C:/photos/2019/x.jpg")).toThrow();
    expect(repo.list()).toHaveLength(0);
  });

  it("rejects a note longer than the cap", () => {
    const repo = fakeRepo();

    expect(() => toggleFavPhoto(repo, PATH, "x".repeat(501))).toThrow();
    expect(repo.list()).toHaveLength(0);
  });
});

describe("addFavPhoto", () => {
  it("stars a photo with its note and reports the change", () => {
    const repo = fakeRepo();

    expect(addFavPhoto(repo, PATH, "  Grandma's birthday  ")).toBe(true);
    // Trimmed by the schema, so trailing whitespace can't make a note look present.
    expect(repo.get(PATH)?.note).toBe("Grandma's birthday");
  });

  it("is idempotent, and does not overwrite an existing note", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH, "The original note");

    expect(addFavPhoto(repo, PATH, "")).toBe(false);
    expect(repo.get(PATH)?.note).toBe("The original note");
  });
});

describe("removeFavPhoto", () => {
  it("un-stars a starred photo and reports the change", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH);

    expect(removeFavPhoto(repo, PATH)).toBe(true);
    expect(repo.isFavorite(PATH)).toBe(false);
  });

  it("reports no change for a photo that was never starred", () => {
    const repo = fakeRepo();

    expect(removeFavPhoto(repo, PATH)).toBe(false);
  });
});

describe("setFavPhotoNote", () => {
  it("rewrites the note on a favourite", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH);

    expect(setFavPhotoNote(repo, PATH, "Von Thun Farm")).toBe(true);
    expect(repo.get(PATH)?.note).toBe("Von Thun Farm");
  });

  it("clears a note back to empty", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH, "Written by mistake");

    expect(setFavPhotoNote(repo, PATH, "")).toBe(true);
    expect(repo.get(PATH)?.note).toBe("");
  });

  it("refuses to resurrect a favourite removed in another tab", () => {
    const repo = fakeRepo();

    expect(setFavPhotoNote(repo, PATH, "A note for a row that is gone")).toBe(false);
    expect(repo.list()).toHaveLength(0);
  });

  it("rejects a note longer than the cap without touching the row", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH, "Safe");

    expect(() => setFavPhotoNote(repo, PATH, "x".repeat(501))).toThrow();
    expect(repo.get(PATH)?.note).toBe("Safe");
  });
});

describe("isFavPhoto", () => {
  it("answers for a starred and an unstarred photo", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH);

    expect(isFavPhoto(repo, PATH)).toBe(true);
    expect(isFavPhoto(repo, OTHER)).toBe(false);
  });

  it("says no for an unusable path instead of throwing", () => {
    const repo = fakeRepo();

    // A question, not a change: the card only wants to know which glyph to draw, and
    // a card must not crash the home screen over a malformed path.
    expect(isFavPhoto(repo, "../escape.jpg")).toBe(false);
    expect(isFavPhoto(repo, "")).toBe(false);
  });
});

describe("listFavPhotos", () => {
  it("comes back newest first", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH);
    addFavPhoto(repo, OTHER);

    expect(listFavPhotos(repo).map((row) => row.relativePath)).toEqual([OTHER, PATH]);
  });

  it("is empty when nothing is starred", () => {
    expect(listFavPhotos(fakeRepo())).toEqual([]);
  });
});

describe("getFavPhoto", () => {
  it("returns the favourite, or undefined when it isn't one", () => {
    const repo = fakeRepo();
    addFavPhoto(repo, PATH, "Kept");

    expect(getFavPhoto(repo, PATH)?.note).toBe("Kept");
    expect(getFavPhoto(repo, OTHER)).toBeUndefined();
  });
});
