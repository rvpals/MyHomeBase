import { beforeEach, describe, expect, it } from "vitest";
import {
  addPhotosToAlbum,
  albumIdsContaining,
  createAlbum,
  deleteAlbum,
  getAlbum,
  listAlbums,
  removePhotosFromAlbum,
  reorderAlbumPhotos,
  updateAlbum,
} from "./albums";
import type { AlbumRepository } from "./ports";
import { MAX_ALBUM_PHOTOS } from "./schema";
import type { Album, AlbumPhoto, AlbumSummary, AlbumWithPhotos } from "./types";

const JUNE = "2019/2019-06 June/IMG_20190609_143501.jpg";
const JULY = "2019/2019-07 July/IMG_20190704_101500.jpg";
const AUGUST = "2019/2019-08 August/IMG_20190812_090000.jpg";

/**
 * A hand-written in-memory album store.
 *
 * A fake rather than a mock, per ARCHITECTURE.md: it implements the real port, so the
 * tests assert on the state it lands in rather than on which methods were called in
 * which order. It reproduces the three behaviours the use-cases actually lean on —
 * case-insensitive name collision, append-after-max ordering, and skip-on-duplicate —
 * because a fake that got those wrong would let a broken use-case pass.
 */
class FakeAlbumRepository implements AlbumRepository {
  private albums: Album[] = [];
  private photos = new Map<number, AlbumPhoto[]>();
  private nextId = 1;
  private clock = 0;

  /** Distinct, increasing timestamps, so an `updatedAt` change is observable. */
  private now(): string {
    this.clock += 1;
    return `2026-09-10 12:00:${String(this.clock).padStart(2, "0")}`;
  }

  listSummaries(): AlbumSummary[] {
    return [...this.albums]
      .reverse()
      .map((album) => {
        const photos = this.photos.get(album.id) ?? [];
        return {
          ...album,
          photoCount: photos.length,
          coverPath: photos[0]?.relativePath,
        };
      });
  }

  get(id: number): Album | undefined {
    return this.albums.find((album) => album.id === id);
  }

  getWithPhotos(id: number): AlbumWithPhotos | undefined {
    const album = this.get(id);
    if (album === undefined) return undefined;
    return { ...album, photos: this.listPhotos(id) };
  }

  nameExists(name: string, exceptId?: number): boolean {
    return this.albums.some(
      (album) =>
        album.name.toLowerCase() === name.toLowerCase() && album.id !== exceptId,
    );
  }

  create(name: string, description: string): Album {
    const stamp = this.now();
    const album: Album = {
      id: this.nextId++,
      name,
      description,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.albums.push(album);
    this.photos.set(album.id, []);
    return album;
  }

  update(id: number, name: string, description: string): void {
    const album = this.get(id);
    if (album === undefined) return;
    album.name = name;
    album.description = description;
    album.updatedAt = this.now();
  }

  remove(id: number): void {
    this.albums = this.albums.filter((album) => album.id !== id);
    this.photos.delete(id);
  }

  listPhotos(albumId: number): AlbumPhoto[] {
    return [...(this.photos.get(albumId) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.relativePath.localeCompare(b.relativePath),
    );
  }

  addPhotos(albumId: number, relativePaths: string[]): number {
    const existing = this.photos.get(albumId) ?? [];
    let order = existing.reduce((max, photo) => Math.max(max, photo.sortOrder + 1), 0);
    let added = 0;
    for (const relativePath of relativePaths) {
      if (existing.some((photo) => photo.relativePath === relativePath)) continue;
      existing.push({ relativePath, sortOrder: order, addedAt: this.now() });
      order += 1;
      added += 1;
    }
    this.photos.set(albumId, existing);
    return added;
  }

  removePhotos(albumId: number, relativePaths: string[]): number {
    const existing = this.photos.get(albumId) ?? [];
    const keep = existing.filter((photo) => !relativePaths.includes(photo.relativePath));
    this.photos.set(albumId, keep);
    return existing.length - keep.length;
  }

  setPhotoOrder(albumId: number, relativePaths: string[]): void {
    const existing = this.photos.get(albumId) ?? [];
    for (const photo of existing) {
      photo.sortOrder = relativePaths.indexOf(photo.relativePath);
    }
  }

  albumIdsContaining(relativePath: string): number[] {
    const ids: number[] = [];
    for (const [albumId, photos] of this.photos) {
      if (photos.some((photo) => photo.relativePath === relativePath)) ids.push(albumId);
    }
    return ids;
  }
}

let repo: FakeAlbumRepository;

/** Creates an album and returns its id, failing loudly if the create didn't take. */
function makeAlbum(name = "Croatia"): number {
  const result = createAlbum(repo, { name, description: "" });
  if (!result.ok) throw new Error(`fixture failed: ${result.error}`);
  return result.value.id;
}

beforeEach(() => {
  repo = new FakeAlbumRepository();
});

describe("createAlbum", () => {
  it("creates an album with a trimmed name and a blank description", () => {
    const result = createAlbum(repo, { name: "  Croatia  " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Croatia");
    // Blank, never null — the settings rule in coding-guide.md.
    expect(result.value.description).toBe("");
  });

  it("refuses a duplicate name, and says which one", () => {
    makeAlbum("Croatia");
    const result = createAlbum(repo, { name: "Croatia", description: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Croatia");
    expect(listAlbums(repo)).toHaveLength(1);
  });

  it("treats a name differing only in case as a duplicate", () => {
    // Two albums a reader cannot tell apart in a nav list are two albums they will
    // open the wrong one of.
    makeAlbum("Croatia");
    expect(createAlbum(repo, { name: "croatia", description: "" }).ok).toBe(false);
  });

  it("rejects a blank name rather than storing an unclickable row", () => {
    expect(() => createAlbum(repo, { name: "   ", description: "" })).toThrow();
  });

  it("rejects a name past the cap", () => {
    expect(() => createAlbum(repo, { name: "A".repeat(121), description: "" })).toThrow();
  });
});

describe("updateAlbum", () => {
  it("renames and re-describes in one write", () => {
    const id = makeAlbum("Croatia");
    const result = updateAlbum(repo, { id, name: "Croatia 2019", description: "Split." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Croatia 2019");
    expect(result.value.description).toBe("Split.");
  });

  it("lets an album keep its own name", () => {
    // Without `exceptId` this collides with the very row being renamed, so editing
    // only the description would be impossible.
    const id = makeAlbum("Croatia");
    const result = updateAlbum(repo, { id, name: "Croatia", description: "Split." });

    expect(result.ok).toBe(true);
  });

  it("refuses a name another album already has", () => {
    makeAlbum("Croatia");
    const second = makeAlbum("Italy");
    const result = updateAlbum(repo, { id: second, name: "Croatia", description: "" });

    expect(result.ok).toBe(false);
  });

  it("reports an album deleted in another tab rather than silently doing nothing", () => {
    const result = updateAlbum(repo, { id: 999, name: "Ghost", description: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no longer exists");
  });
});

describe("deleteAlbum", () => {
  it("removes the album", () => {
    const id = makeAlbum();
    expect(deleteAlbum(repo, id).ok).toBe(true);
    expect(listAlbums(repo)).toHaveLength(0);
  });

  it("is idempotent, because two tabs racing on one delete both got what they asked for", () => {
    const id = makeAlbum();
    deleteAlbum(repo, id);
    expect(deleteAlbum(repo, id).ok).toBe(true);
  });

  it("rejects a malformed id rather than treating it as a soft failure", () => {
    // A caller bug, not something a reader can fix — so it throws rather than
    // returning { ok: false }.
    expect(() => deleteAlbum(repo, "not-a-number")).toThrow();
  });
});

describe("addPhotosToAlbum", () => {
  it("adds photographs and reports the count", () => {
    const id = makeAlbum();
    const result = addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ added: 2, alreadyPresent: 0 });
  });

  it("skips photographs already in the album and says how many", () => {
    // The honest report when someone multi-selects across a folder they have partly
    // filed already.
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE] });

    const result = addPhotosToAlbum(repo, {
      albumId: id,
      relativePaths: [JUNE, JULY, AUGUST],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ added: 2, alreadyPresent: 1 });
  });

  it("does not move an already-filed photo to the end", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY] });
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE] });

    expect(getAlbum(repo, id)?.photos.map((photo) => photo.relativePath)).toEqual([
      JUNE,
      JULY,
    ]);
  });

  it("collapses two spellings of one path within a single request", () => {
    // A backslash spelling and a forward-slash one are the same file, and would
    // otherwise become two membership rows the unique index never sees as equal.
    const id = makeAlbum();
    const result = addPhotosToAlbum(repo, {
      albumId: id,
      relativePaths: [JUNE, JUNE.split("/").join("\\")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.added).toBe(1);
  });

  it("appends in order, so an album's sequence is what the reader built", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [AUGUST] });
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY] });

    expect(getAlbum(repo, id)?.photos.map((photo) => photo.relativePath)).toEqual([
      AUGUST,
      JUNE,
      JULY,
    ]);
  });

  it("reports an album deleted in another tab", () => {
    const result = addPhotosToAlbum(repo, { albumId: 999, relativePaths: [JUNE] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no longer exists");
  });

  it("refuses to push an album past the cap, counting what it would become", () => {
    const id = makeAlbum();
    const existing = Array.from(
      { length: MAX_ALBUM_PHOTOS - 1 },
      (_unused, index) => `2019/2019-06 June/IMG_${index}.jpg`,
    );
    addPhotosToAlbum(repo, { albumId: id, relativePaths: existing });

    const result = addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(MAX_ALBUM_PHOTOS));
  });

  it("rejects a traversal path, so a crafted row can never reach the image route", () => {
    const id = makeAlbum();
    expect(() =>
      addPhotosToAlbum(repo, { albumId: id, relativePaths: ["../../etc/passwd"] }),
    ).toThrow();
  });

  it("rejects an absolute path", () => {
    const id = makeAlbum();
    expect(() =>
      addPhotosToAlbum(repo, { albumId: id, relativePaths: ["/etc/passwd"] }),
    ).toThrow();
  });

  it("rejects an empty selection as a caller bug", () => {
    const id = makeAlbum();
    expect(() => addPhotosToAlbum(repo, { albumId: id, relativePaths: [] })).toThrow();
  });
});

describe("removePhotosFromAlbum", () => {
  it("unfiles photographs and reports how many went", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY, AUGUST] });

    const result = removePhotosFromAlbum(repo, {
      albumId: id,
      relativePaths: [JUNE, AUGUST],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removed).toBe(2);
    expect(getAlbum(repo, id)?.photos.map((photo) => photo.relativePath)).toEqual([JULY]);
  });

  it("counts only what was actually there", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE] });

    const result = removePhotosFromAlbum(repo, {
      albumId: id,
      relativePaths: [JUNE, JULY],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removed).toBe(1);
  });

  it("reports an album deleted in another tab", () => {
    expect(removePhotosFromAlbum(repo, { albumId: 999, relativePaths: [JUNE] }).ok).toBe(
      false,
    );
  });
});

describe("reorderAlbumPhotos", () => {
  it("rewrites the album's order", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY, AUGUST] });

    const result = reorderAlbumPhotos(repo, {
      albumId: id,
      relativePaths: [AUGUST, JUNE, JULY],
    });

    expect(result.ok).toBe(true);
    expect(getAlbum(repo, id)?.photos.map((photo) => photo.relativePath)).toEqual([
      AUGUST,
      JUNE,
      JULY,
    ]);
  });

  it("refuses an order that would silently drop a photo", () => {
    // A stale client sending three of four photos must not delete the fourth. This is
    // the data loss nobody would be able to see.
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY, AUGUST] });

    const result = reorderAlbumPhotos(repo, { albumId: id, relativePaths: [JUNE, JULY] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("changed while you were rearranging");
    expect(getAlbum(repo, id)?.photos).toHaveLength(3);
  });

  it("refuses an order that would silently add a photo", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE] });

    expect(
      reorderAlbumPhotos(repo, { albumId: id, relativePaths: [JUNE, JULY] }).ok,
    ).toBe(false);
  });

  it("refuses an order containing a duplicate", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE, JULY] });

    expect(
      reorderAlbumPhotos(repo, { albumId: id, relativePaths: [JUNE, JUNE] }).ok,
    ).toBe(false);
  });

  it("reports an album deleted in another tab", () => {
    expect(reorderAlbumPhotos(repo, { albumId: 999, relativePaths: [] }).ok).toBe(false);
  });
});

describe("listAlbums", () => {
  it("reports a photo count and a cover for each album", () => {
    const croatia = makeAlbum("Croatia");
    makeAlbum("Empty");
    addPhotosToAlbum(repo, { albumId: croatia, relativePaths: [JUNE, JULY] });

    const summaries = listAlbums(repo);
    const withPhotos = summaries.find((album) => album.name === "Croatia");
    const empty = summaries.find((album) => album.name === "Empty");

    expect(withPhotos?.photoCount).toBe(2);
    // The FIRST photo, not a random one, so a tile looks the same on every visit.
    expect(withPhotos?.coverPath).toBe(JUNE);
    expect(empty?.photoCount).toBe(0);
    expect(empty?.coverPath).toBeUndefined();
  });
});

describe("albumIdsContaining", () => {
  it("names every album holding the photo, for the viewer's + menu ticks", () => {
    const croatia = makeAlbum("Croatia");
    const best = makeAlbum("Best of 2019");
    makeAlbum("Italy");
    addPhotosToAlbum(repo, { albumId: croatia, relativePaths: [JUNE] });
    addPhotosToAlbum(repo, { albumId: best, relativePaths: [JUNE] });

    expect(albumIdsContaining(repo, JUNE).sort()).toEqual([croatia, best].sort());
  });

  it("returns nothing for a photo in no album", () => {
    makeAlbum();
    expect(albumIdsContaining(repo, JUNE)).toEqual([]);
  });

  it("matches across two spellings of one path", () => {
    const id = makeAlbum();
    addPhotosToAlbum(repo, { albumId: id, relativePaths: [JUNE] });

    expect(albumIdsContaining(repo, JUNE.split("/").join("\\"))).toEqual([id]);
  });

  it("rejects a traversal path", () => {
    expect(() => albumIdsContaining(repo, "../../etc/passwd")).toThrow();
  });
});
