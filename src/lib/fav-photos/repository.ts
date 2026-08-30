import type Database from "better-sqlite3";
import type { FavPhotoRepository } from "./ports";
import type { FavPhoto } from "./types";

interface FavPhotoRow {
  relative_path: string;
  note: string;
  created_at: string;
}

function toFavPhoto(row: FavPhotoRow): FavPhoto {
  return { relativePath: row.relative_path, note: row.note, createdAt: row.created_at };
}

// Keyed by relative path, so both writes are single-statement and idempotent — see
// migrations/0073_create_fav_photo.md for why there's no surrogate id, and why the key
// is the path from the photo root rather than an absolute one.
export class SqliteFavPhotoRepository implements FavPhotoRepository {
  constructor(private db: Database.Database) {}

  list(): FavPhoto[] {
    // `relative_path` breaks ties: two photos starred in the same second would
    // otherwise come back in an arbitrary order that could change between reads.
    const rows = this.db
      .prepare("SELECT * FROM sys_fav_photo ORDER BY created_at DESC, relative_path")
      .all() as FavPhotoRow[];
    return rows.map(toFavPhoto);
  }

  get(relativePath: string): FavPhoto | undefined {
    const row = this.db
      .prepare("SELECT * FROM sys_fav_photo WHERE relative_path = ?")
      .get(relativePath) as FavPhotoRow | undefined;
    return row === undefined ? undefined : toFavPhoto(row);
  }

  isFavorite(relativePath: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM sys_fav_photo WHERE relative_path = ?")
      .get(relativePath) as { 1: number } | undefined;
    return row !== undefined;
  }

  add(relativePath: string, note: string): void {
    // DO NOTHING rather than an upsert, for two reasons. Re-starring must not move a
    // favourite to the top of the list, because the click that does it is the click
    // that *unstars* — an accidental double-press should leave the list untouched. And
    // an upsert would blank an existing note with this call's default `""`.
    this.db
      .prepare(
        "INSERT INTO sys_fav_photo (relative_path, note) VALUES (?, ?) ON CONFLICT(relative_path) DO NOTHING",
      )
      .run(relativePath, note);
  }

  remove(relativePath: string): void {
    this.db.prepare("DELETE FROM sys_fav_photo WHERE relative_path = ?").run(relativePath);
  }

  setNote(relativePath: string, note: string): void {
    // An UPDATE, so a photo that is no longer starred is silently untouched rather
    // than resurrected — the `WHERE` is the whole guard the use-case relies on.
    this.db
      .prepare("UPDATE sys_fav_photo SET note = ? WHERE relative_path = ?")
      .run(note, relativePath);
  }
}
