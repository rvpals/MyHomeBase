import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteMusicRepository } from "./repository";

// `listAlbums` backs the Library's Albums view. It existed before that view did, read
// only by the CLI's scan summary, so these are its first tests -- the cover-BLOB
// exclusion in particular is load-bearing now that a page of 50 albums renders at once.
//
// 0052 creates mus_albums, which is all these tests touch.
function memoryMusicRepo(): { repo: SqliteMusicRepository; db: Database.Database } {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(path.join(process.cwd(), "migrations", "0052_create_music_library.sql"), "utf8"),
  );
  return { repo: new SqliteMusicRepository(db), db };
}

function insertAlbum(
  db: Database.Database,
  album: {
    name: string;
    albumArtist?: string;
    genre?: string;
    releaseYear?: number | null;
    trackCount?: number;
    cover?: Buffer;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO mus_albums (name, album_artist, genre, release_year, track_count, cover_image, cover_mime_type)
       VALUES (@name, @albumArtist, @genre, @releaseYear, @trackCount, @cover, @mimeType)`,
    )
    .run({
      name: album.name,
      albumArtist: album.albumArtist ?? "",
      genre: album.genre ?? "",
      releaseYear: album.releaseYear ?? null,
      trackCount: album.trackCount ?? 0,
      cover: album.cover ?? null,
      mimeType: album.cover === undefined ? "" : "image/jpeg",
    });
  return Number(result.lastInsertRowid);
}

describe("listAlbums", () => {
  it("returns a page of albums ordered by album artist, then name", () => {
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, { name: "Tribute", albumArtist: "Yanni" });
    insertAlbum(db, { name: "Dare to Dream", albumArtist: "Yanni" });
    insertAlbum(db, { name: "Shepherd Moons", albumArtist: "Enya" });

    const { albums, totalCount } = repo.listAlbums({ limit: 50, offset: 0 });

    expect(totalCount).toBe(3);
    expect(albums.map((album) => `${album.albumArtist} / ${album.name}`)).toEqual([
      "Enya / Shepherd Moons",
      "Yanni / Dare to Dream",
      "Yanni / Tribute",
    ]);
  });

  it("reports cover presence without ever returning the bytes", () => {
    // The whole reason the Albums view can render 50 tiles: the grid learns which
    // albums have art and fetches each image from its own cached route instead of
    // carrying megabytes of BLOB through the server action's payload.
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, { name: "With Cover", albumArtist: "A", cover: Buffer.from([1, 2, 3]) });
    insertAlbum(db, { name: "No Cover", albumArtist: "B" });

    const { albums } = repo.listAlbums({ limit: 50, offset: 0 });

    expect(albums[0].hasCoverImage).toBe(true);
    expect(albums[1].hasCoverImage).toBe(false);
    // No album object carries image bytes, whatever the column held.
    for (const album of albums) {
      expect(Object.keys(album)).not.toContain("coverImage");
      expect(JSON.stringify(album)).not.toContain("1,2,3");
    }
  });

  it("carries the facts a cover tile shows beside the image", () => {
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, {
      name: "Reflections of Passion",
      albumArtist: "Yanni",
      genre: "New Age",
      releaseYear: 1990,
      trackCount: 11,
    });

    const [album] = repo.listAlbums({ limit: 50, offset: 0 }).albums;

    expect(album.name).toBe("Reflections of Passion");
    expect(album.trackCount).toBe(11);
    expect(album.releaseYear).toBe(1990);
    expect(album.genre).toBe("New Age");
  });

  it("leaves an unknown release year undefined rather than reporting year 0", () => {
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, { name: "Undated", albumArtist: "Various", releaseYear: null });

    const [album] = repo.listAlbums({ limit: 50, offset: 0 }).albums;

    // The tile prints the year only when there is one; 0 would render as "· 0".
    expect(album.releaseYear).toBeUndefined();
  });

  it("searches on album name and on album artist", () => {
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, { name: "Shepherd Moons", albumArtist: "Enya" });
    insertAlbum(db, { name: "Tribute", albumArtist: "Yanni" });

    // By name...
    expect(repo.listAlbums({ limit: 50, offset: 0, search: "shepherd" }).albums).toHaveLength(1);
    // ...and by artist, case-insensitively, which is how someone hunting a cover types.
    const byArtist = repo.listAlbums({ limit: 50, offset: 0, search: "YANNI" });
    expect(byArtist.totalCount).toBe(1);
    expect(byArtist.albums[0].name).toBe("Tribute");
  });

  it("reports the unfiltered total for a search that matches nothing", () => {
    const { repo, db } = memoryMusicRepo();
    insertAlbum(db, { name: "Tribute", albumArtist: "Yanni" });

    const result = repo.listAlbums({ limit: 50, offset: 0, search: "nothing here" });

    expect(result.albums).toEqual([]);
    // The count must match the filter, not the table -- the pager reads it.
    expect(result.totalCount).toBe(0);
  });

  it("pages without dropping or repeating a row", () => {
    const { repo, db } = memoryMusicRepo();
    for (const name of ["A", "B", "C", "D", "E"]) {
      insertAlbum(db, { name, albumArtist: "Artist" });
    }

    const first = repo.listAlbums({ limit: 2, offset: 0 });
    const second = repo.listAlbums({ limit: 2, offset: 2 });
    const third = repo.listAlbums({ limit: 2, offset: 4 });

    // Total is the whole set on every page, so the pager can say "5".
    expect(first.totalCount).toBe(5);
    expect(third.totalCount).toBe(5);
    expect([...first.albums, ...second.albums, ...third.albums].map((a) => a.name)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("returns an empty page rather than throwing when nothing is catalogued", () => {
    const { repo } = memoryMusicRepo();

    const result = repo.listAlbums({ limit: 50, offset: 0 });

    expect(result.albums).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
