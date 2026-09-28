import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DashboardTextureRepository } from "./ports";
import type {
  DashboardTexture,
  DashboardTextureItem,
  DashboardTextureSettings,
} from "./types";

/**
 * Every column a library read needs — and **not** `image`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB and holds
 * up to 20 of them. A `SELECT *` here would materialise as much as 80 MB of
 * picture on an admin page render, for bytes only the serving route wants.
 * Presence is derived instead. Same rule as `MODULE_COLUMNS`; see
 * `migrations/0113_create_dashboard_texture_library.md`.
 *
 * Takes the table's alias because `getTexture()` joins the library to the
 * selection singleton, and the two share `id` *and* `updated_at` — unqualified,
 * SQLite rejects the query with "ambiguous column name". `listTextures()` reads
 * one table and would not need the prefix, but both callers using the same
 * qualified list is what stops the two drifting apart again.
 */
const textureColumns = (alias: string) => `
  ${alias}.id, ${alias}.name, ${alias}.opacity, ${alias}.mode, ${alias}.blur,
  ${alias}.updated_at, ${alias}.image IS NOT NULL AS has_image
`;

interface TextureRow {
  id: number;
  name: string;
  opacity: number;
  mode: string;
  blur: number;
  updated_at: string;
  has_image: number;
}

/**
 * The dashboard with no picture: nothing selected, or a selection pointing at a
 * row that has since been deleted.
 *
 * The knob values mirror the column defaults in migration 0113. They are never
 * drawn — `hasImage: false` makes `dashboardTextureCssVars` return `undefined`
 * and the page skips the layer — but returning a whole object rather than
 * `undefined` keeps every caller free of a branch for a state that means nothing
 * more than "no picture yet".
 */
const TEXTURE_FALLBACK: DashboardTexture = {
  selectedId: undefined,
  hasImage: false,
  opacity: 0.1,
  mode: "cover",
  blur: 0,
  updatedAt: "",
};

/** Narrowed by the table's CHECK, so this describes a guarantee rather than assuming one. */
function toMode(value: string): "cover" | "tile" {
  return value === "tile" ? "tile" : "cover";
}

function toItem(row: TextureRow): DashboardTextureItem {
  return {
    id: row.id,
    name: row.name,
    hasImage: row.has_image === 1,
    opacity: row.opacity,
    mode: toMode(row.mode),
    blur: row.blur,
    updatedAt: row.updated_at,
  };
}

export class SqliteDashboardTextureRepository implements DashboardTextureRepository {
  constructor(private db: Database.Database) {}

  getTexture(): DashboardTexture {
    // An INNER JOIN, so a `selected_texture_id` left dangling by a delete this
    // code didn't perform (a hand-edited row, a restored backup) yields no row
    // and falls through to "no texture" — rather than a half-populated object
    // the dashboard would try to draw. The foreign key isn't enforced by the
    // database (see migration 0113), so this read cannot trust the column.
    const row = this.db
      .prepare(
        `SELECT ${textureColumns("texture")}
           FROM sys_dashboard_texture AS selection
           JOIN sys_dashboard_textures AS texture
             ON texture.id = selection.selected_texture_id
          WHERE selection.id = 1`,
      )
      .get() as TextureRow | undefined;
    if (!row) return TEXTURE_FALLBACK;

    const item = toItem(row);
    return {
      selectedId: item.id,
      hasImage: item.hasImage,
      opacity: item.opacity,
      mode: item.mode,
      blur: item.blur,
      updatedAt: item.updatedAt,
    };
  }

  listTextures(): DashboardTextureItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${textureColumns("texture")}
           FROM sys_dashboard_textures AS texture
          ORDER BY texture.sort_order, texture.id`,
      )
      .all() as TextureRow[];
    return rows.map(toItem);
  }

  getTextureImage(id?: number): DecodedImage | undefined {
    // The only read that touches the BLOB. With no id, resolve the selection
    // here rather than making the route do it in two queries.
    const row = (
      id === undefined
        ? this.db
            .prepare(
              `SELECT texture.image, texture.image_mime_type
                 FROM sys_dashboard_texture AS selection
                 JOIN sys_dashboard_textures AS texture
                   ON texture.id = selection.selected_texture_id
                WHERE selection.id = 1`,
            )
            .get()
        : this.db
            .prepare(
              `SELECT image, image_mime_type FROM sys_dashboard_textures WHERE id = ?`,
            )
            .get(id)
    ) as { image: Buffer | null; image_mime_type: string | null } | undefined;

    if (!row?.image || !row.image_mime_type) return undefined;
    return { data: row.image, mimeType: row.image_mime_type };
  }

  addTexture(name: string, image: DecodedImage): number {
    // Appended: one past the current maximum, so a picture lands at the end of
    // the gallery where the admin just added it. COALESCE covers the first row,
    // where MAX over no rows is NULL.
    const result = this.db
      .prepare(
        `INSERT INTO sys_dashboard_textures
                (name, image, image_mime_type, sort_order, updated_at)
         VALUES (@name, @data, @mimeType,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sys_dashboard_textures),
                 datetime('now'))`,
      )
      .run({ name, data: image.data, mimeType: image.mimeType });

    return Number(result.lastInsertRowid);
  }

  replaceTextureImage(id: number, image: DecodedImage): boolean {
    // `updated_at` bumped so the serving route's ?v= cache-buster changes and
    // the new picture shows up immediately rather than after max-age expires.
    const result = this.db
      .prepare(
        `UPDATE sys_dashboard_textures
            SET image = @data, image_mime_type = @mimeType, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ id, data: image.data, mimeType: image.mimeType });

    return result.changes > 0;
  }

  renameTexture(id: number, name: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE sys_dashboard_textures
            SET name = @name, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ id, name });

    return result.changes > 0;
  }

  deleteTexture(id: number): boolean {
    // Both statements or neither: a delete that left the pointer behind would
    // leave the singleton naming a row that no longer exists. `getTexture()`
    // tolerates that (the JOIN finds nothing), but tolerating a state is not a
    // reason to create one — a later re-use of the id by AUTOINCREMENT would
    // otherwise silently resurrect a selection.
    const remove = this.db.transaction((textureId: number) => {
      const result = this.db
        .prepare(`DELETE FROM sys_dashboard_textures WHERE id = ?`)
        .run(textureId);
      if (result.changes === 0) return false;

      this.db
        .prepare(
          `UPDATE sys_dashboard_texture
              SET selected_texture_id = NULL, updated_at = datetime('now')
            WHERE id = 1 AND selected_texture_id = ?`,
        )
        .run(textureId);
      return true;
    });

    return remove(id);
  }

  selectTexture(id: number | undefined): boolean {
    // Selecting nothing always succeeds — "no texture" is a legal destination,
    // and reporting failure for it would make the caller branch on a
    // non-problem.
    if (id !== undefined) {
      const exists = this.db
        .prepare(`SELECT 1 FROM sys_dashboard_textures WHERE id = ?`)
        .get(id);
      if (!exists) return false;
    }

    // An upsert, not an UPDATE. The 0063 migration seeds row 1, so in practice
    // the row is there — but an UPDATE against a missing row affects nothing and
    // reports success. The row's identity is a constant, so the write can simply
    // guarantee it.
    this.db
      .prepare(
        `INSERT INTO sys_dashboard_texture (id, selected_texture_id, updated_at)
              VALUES (1, @id, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
              selected_texture_id = excluded.selected_texture_id,
              updated_at = excluded.updated_at`,
      )
      .run({ id: id ?? null });

    return true;
  }

  setSettings(id: number, settings: DashboardTextureSettings): boolean {
    const result = this.db
      .prepare(
        `UPDATE sys_dashboard_textures
            SET opacity = @opacity, mode = @mode, blur = @blur, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ id, ...settings });

    return result.changes > 0;
  }
}
