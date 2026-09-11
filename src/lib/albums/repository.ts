import type Database from "better-sqlite3";
import type { AlbumRepository } from "./ports";
import type { Album, AlbumPhoto, AlbumSummary, AlbumWithPhotos } from "./types";

// The only file in this module that knows SQL. Tables are `pho_albums` and
// `pho_album_photos` — the `pho_` prefix is Picture Gallery's, named for the domain
// (photos) rather than for albums specifically, so a later table in this module has
// somewhere to live. See migrations/0087_create_albums.md.

interface AlbumRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface AlbumSummaryRow extends AlbumRow {
  photo_count: number;
  cover_path: string | null;
}

interface AlbumPhotoRow {
  relative_path: string;
  sort_order: number;
  added_at: string;
}

function toAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAlbumPhoto(row: AlbumPhotoRow): AlbumPhoto {
  return {
    relativePath: row.relative_path,
    sortOrder: row.sort_order,
    addedAt: row.added_at,
  };
}

export class SqliteAlbumRepository implements AlbumRepository {
  constructor(private db: Database.Database) {}

  listSummaries(): AlbumSummary[] {
    // Count and cover come from SQL rather than from loading every membership row:
    // the list renders every album at once, and reading a thousand rows to print six
    // numbers is work nobody asked for.
    //
    // The cover is a correlated subquery rather than a join, because a join to the
    // first photo needs either a window function or a GROUP BY that fights the count
    // aggregate. `sort_order, relative_path` matches `listPhotos`'s ordering exactly,
    // so the tile shows the same picture the detail screen opens with.
    const rows = this.db
      .prepare(
        `SELECT a.*,
                (SELECT COUNT(*) FROM pho_album_photos p WHERE p.album_id = a.id) AS photo_count,
                (SELECT p.relative_path FROM pho_album_photos p
                  WHERE p.album_id = a.id
                  ORDER BY p.sort_order, p.relative_path
                  LIMIT 1) AS cover_path
           FROM pho_albums a
          ORDER BY a.created_at DESC, a.id DESC`,
      )
      .all() as AlbumSummaryRow[];

    return rows.map((row) => ({
      ...toAlbum(row),
      photoCount: row.photo_count,
      // `?? undefined` rather than passing the NULL through: the domain type says the
      // field is absent when there is no cover, and `null` would make every caller
      // check two empty values instead of one.
      coverPath: row.cover_path ?? undefined,
    }));
  }

  get(id: number): Album | undefined {
    const row = this.db.prepare("SELECT * FROM pho_albums WHERE id = ?").get(id) as
      | AlbumRow
      | undefined;
    return row === undefined ? undefined : toAlbum(row);
  }

  getWithPhotos(id: number): AlbumWithPhotos | undefined {
    const album = this.get(id);
    if (album === undefined) return undefined;
    return { ...album, photos: this.listPhotos(id) };
  }

  nameExists(name: string, exceptId?: number): boolean {
    // `NOCASE` so "Christmas" and "christmas" collide. Two albums whose names differ
    // only in case are indistinguishable in a nav list, and the reader who typed the
    // second one meant to open the first. The unique index is declared COLLATE NOCASE
    // for the same reason, so this check and the constraint agree.
    const row =
      exceptId === undefined
        ? this.db
            .prepare("SELECT 1 FROM pho_albums WHERE name = ? COLLATE NOCASE")
            .get(name)
        : this.db
            .prepare("SELECT 1 FROM pho_albums WHERE name = ? COLLATE NOCASE AND id <> ?")
            .get(name, exceptId);
    return row !== undefined;
  }

  create(name: string, description: string): Album {
    const row = this.db
      .prepare(
        `INSERT INTO pho_albums (name, description, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         RETURNING *`,
      )
      .get(name, description) as AlbumRow;
    return toAlbum(row);
  }

  update(id: number, name: string, description: string): void {
    this.db
      .prepare(
        "UPDATE pho_albums SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(name, description, id);
  }

  remove(id: number): void {
    // The membership rows are deleted EXPLICITLY as well as being covered by
    // `ON DELETE CASCADE`, and both statements run in one transaction.
    //
    // The cascade does fire: `better-sqlite3` turns `PRAGMA foreign_keys` ON by
    // default, unlike the sqlite3 CLI. So this is belt-and-braces rather than the only
    // thing that works — but it is deliberate, for two reasons. It does not depend on a
    // driver default that is invisible from this file and would silently orphan every
    // membership row if it ever changed; and it is what every other parent/child delete
    // in this codebase does, none of which rely on a cascade (see `jrn_entry_tags` in
    // journal/repository.ts). One pattern beats two.
    const run = this.db.transaction((albumId: number) => {
      this.db.prepare("DELETE FROM pho_album_photos WHERE album_id = ?").run(albumId);
      this.db.prepare("DELETE FROM pho_albums WHERE id = ?").run(albumId);
    });
    run(id);
  }

  listPhotos(albumId: number): AlbumPhoto[] {
    // `relative_path` breaks ties: two photos sharing a `sort_order` (only reachable
    // through a hand-written UPDATE) would otherwise come back in an arbitrary order
    // that could change between reads.
    const rows = this.db
      .prepare(
        `SELECT relative_path, sort_order, added_at
           FROM pho_album_photos
          WHERE album_id = ?
          ORDER BY sort_order, relative_path`,
      )
      .all(albumId) as AlbumPhotoRow[];
    return rows.map(toAlbumPhoto);
  }

  addPhotos(albumId: number, relativePaths: string[]): number {
    // Appended after the current maximum, so adding to an album never disturbs the
    // order of what is already in it. COALESCE covers the empty album, where MAX is
    // NULL and `NULL + 1` would be NULL rather than 0.
    const nextOrder = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM pho_album_photos WHERE album_id = ?",
        )
        .get(albumId) as { next: number }
    ).next;

    const insert = this.db.prepare(
      `INSERT INTO pho_album_photos (album_id, relative_path, sort_order, added_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(album_id, relative_path) DO NOTHING`,
    );

    // One transaction for the whole batch: forty sequential inserts against an
    // SMB-backed SQLite file is forty write locks, and a partial add on a mid-way
    // failure would leave the album in a state the reader never asked for.
    //
    // DO NOTHING makes a re-add idempotent — it must not move a photo already in the
    // album to the end, because the click that does that is the click a reader uses to
    // file a picture they had forgotten was already filed.
    const run = this.db.transaction((paths: string[]) => {
      let added = 0;
      let order = nextOrder;
      for (const relativePath of paths) {
        const result = insert.run(albumId, relativePath, order);
        // `changes` is 0 when the conflict clause swallowed it. Only a real insert
        // consumes a position, or a skipped duplicate would leave a gap in the order.
        if (result.changes > 0) {
          added += 1;
          order += 1;
        }
      }
      return added;
    });

    const added = run(relativePaths);
    if (added > 0) this.touch(albumId);
    return added;
  }

  removePhotos(albumId: number, relativePaths: string[]): number {
    if (relativePaths.length === 0) return 0;

    const placeholders = relativePaths.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `DELETE FROM pho_album_photos
          WHERE album_id = ? AND relative_path IN (${placeholders})`,
      )
      .run(albumId, ...relativePaths);

    // Deliberately NOT renumbering the survivors. `sort_order` only has to be
    // ascending for the reads to be correct, and the gaps a delete leaves are
    // invisible — a renumber would be a second write over every remaining row to fix
    // something nothing can observe. `setPhotoOrder` makes it contiguous again when
    // the reader actually rearranges.
    if (result.changes > 0) this.touch(albumId);
    return result.changes;
  }

  setPhotoOrder(albumId: number, relativePaths: string[]): void {
    const update = this.db.prepare(
      "UPDATE pho_album_photos SET sort_order = ? WHERE album_id = ? AND relative_path = ?",
    );
    const run = this.db.transaction((paths: string[]) => {
      paths.forEach((relativePath, index) => update.run(index, albumId, relativePath));
    });
    run(relativePaths);
    this.touch(albumId);
  }

  albumIdsContaining(relativePath: string): number[] {
    const rows = this.db
      .prepare("SELECT album_id FROM pho_album_photos WHERE relative_path = ?")
      .all(relativePath) as { album_id: number }[];
    return rows.map((row) => row.album_id);
  }

  /**
   * Moves the album's `updated_at` after a membership change.
   *
   * Membership is part of what an album IS, so filing a picture into one is a change
   * to that album even though no column on its own row moved. Without this, an album
   * edited only by adding photos would keep reporting the timestamp of its creation.
   */
  private touch(albumId: number): void {
    this.db
      .prepare("UPDATE pho_albums SET updated_at = datetime('now') WHERE id = ?")
      .run(albumId);
  }
}
