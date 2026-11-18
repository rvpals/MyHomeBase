import { describe, expect, it } from "vitest";
import type { AlbumRepository } from "./ports";
import { getHomeAlbumSlideshow, nextSlideIndex, resolveHomeAlbum } from "./slideshow";
import type { AlbumPhoto, AlbumSummary } from "./types";

function summary(id: number, name: string, photoCount = 0): AlbumSummary {
  return {
    id,
    name,
    description: "",
    createdAt: "2026-11-01 00:00:00",
    updatedAt: "2026-11-01 00:00:00",
    photoCount,
  };
}

/**
 * A read-only fake: the slideshow only ever lists summaries and one album's photos, so
 * every write throws — a test that reached one would be testing the wrong thing.
 */
function fakeRepo(summaries: AlbumSummary[], photos: Record<number, string[]>) {
  const reads: number[] = [];
  const unused = () => {
    throw new Error("not used by the slideshow");
  };
  const repo: AlbumRepository = {
    listSummaries: () => summaries,
    listPhotos: (albumId: number): AlbumPhoto[] => {
      reads.push(albumId);
      return (photos[albumId] ?? []).map((relativePath, sortOrder) => ({
        relativePath,
        sortOrder,
        addedAt: "2026-11-01 00:00:00",
      }));
    },
    get: unused,
    getWithPhotos: unused,
    nameExists: unused,
    create: unused,
    update: unused,
    remove: unused,
    addPhotos: unused,
    removePhotos: unused,
    setPhotoOrder: unused,
    albumIdsContaining: unused,
  };
  return { repo, reads };
}

describe("resolveHomeAlbum", () => {
  const albums = [summary(3, "Beach"), summary(1, "Snow")];

  it("returns the stored album when it still exists", () => {
    expect(resolveHomeAlbum(albums, 1)?.name).toBe("Snow");
  });

  it("falls back to the first album when the stored one was deleted", () => {
    expect(resolveHomeAlbum(albums, 99)?.name).toBe("Beach");
  });

  it("falls back to the first album when nothing was ever chosen", () => {
    expect(resolveHomeAlbum(albums, undefined)?.name).toBe("Beach");
  });

  it("returns undefined when there are no albums", () => {
    expect(resolveHomeAlbum([], 1)).toBeUndefined();
  });
});

describe("nextSlideIndex", () => {
  it("steps forward and wraps after the last photo", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(1, 3)).toBe(2);
    expect(nextSlideIndex(2, 3)).toBe(0);
  });

  it("stays at 0 for an empty or one-photo album", () => {
    expect(nextSlideIndex(0, 0)).toBe(0);
    expect(nextSlideIndex(0, 1)).toBe(0);
  });

  it("brings an out-of-range index back into range when the album shrank", () => {
    expect(nextSlideIndex(7, 3)).toBe(2);
  });
});

describe("getHomeAlbumSlideshow", () => {
  it("returns every album for the picker and only the chosen album's photos", () => {
    const { repo, reads } = fakeRepo([summary(3, "Beach", 2), summary(1, "Snow", 1)], {
      3: ["a.jpg", "b.jpg"],
      1: ["c.jpg"],
    });
    const result = getHomeAlbumSlideshow(repo, 1);
    expect(result.albums).toEqual([
      { id: 3, name: "Beach", photoCount: 2 },
      { id: 1, name: "Snow", photoCount: 1 },
    ]);
    expect(result.current).toEqual({ id: 1, name: "Snow", paths: ["c.jpg"] });
    expect(reads).toEqual([1]);
  });

  it("keeps the album's own order", () => {
    const { repo } = fakeRepo([summary(1, "Trip", 3)], { 1: ["z.jpg", "a.jpg", "m.jpg"] });
    expect(getHomeAlbumSlideshow(repo, undefined).current?.paths).toEqual([
      "z.jpg",
      "a.jpg",
      "m.jpg",
    ]);
  });

  it("has no current album and reads no photos when there are no albums", () => {
    const { repo, reads } = fakeRepo([], {});
    expect(getHomeAlbumSlideshow(repo, 5)).toEqual({ albums: [] });
    expect(reads).toEqual([]);
  });
});
