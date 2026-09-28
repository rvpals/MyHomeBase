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
 * The selection singleton's own columns — today just the scope flag.
 *
 * Separate from `textureColumns` because it belongs to the other side of
 * `getTexture()`'s join: `app_wide` is a property of the selection, not of the
 * picture (migration 0116). `listTextures()` reads the library alone and never
 * wants it.
 */
const SELECTION_COLUMNS = `selection.app_wide`;

interface SelectionRow {
  app_wide: number;
}

/**
 * The dashboard with no picture: nothing selected, or a selection pointing at a
 * row that has since been deleted.
 *
 * The knob values mirror the column defaults in migration 0113. They are never
 * drawn — `hasImage: false` makes `resolveAppTexture` emit no vars and the page
 * skips the layer — but returning a whole object rather than
 * `undefined` keeps every caller free of a branch for a state that means nothing
 * more than "no picture yet".
 */
const TEXTURE_FALLBACK: DashboardTexture = {
  selectedId: undefined,
  // False even when the row says otherwise: with no picture selected there is
  // nothing to draw anywhere, so "app-wide" describes no layer at all. The flag
  // is preserved in storage and comes back when a picture is selected again.
  appWide: false,
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
        `SELECT ${textureColumns("texture")}, ${SELECTION_COLUMNS}
           FROM sys_dashboard_texture AS selection
           JOIN sys_dashboard_textures AS texture
             ON texture.id = selection.selected_texture_id
          WHERE selection.id = 1`,
      )
      .get() as (TextureRow & SelectionRow) | undefined;
    if (!row) return TEXTURE_FALLBACK;

    const item = toItem(row);
    return {
      selectedId: item.id,
      // From the selection side of the join, not the picture — see 0116. The
      // INNER JOIN means a dangling selection yields no row at all and falls
      // through to the fallback above, so this is only read when a real picture
      // is selected.
      appWide: row.app_wide === 1,
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

  setAppWide(appWide: boolean): void {
    // Writes the selection row, not a picture row: scope belongs to the
    // selection (migration 0116). An upsert for the same reason `selectTexture`
    // uses one — the row's identity is the constant 1, so the write guarantees
    // it rather than trusting 0063's seed to still be there.
    //
    // Returns void, not boolean: unlike the id-keyed writers above there is no
    // "not found" case to report. The row is either updated or created.
    //
    // `updated_at` is bumped, which also moves the serving route's ?v=
    // cache-buster. Harmless — the bytes are unchanged, so the refetch returns
    // the same picture — and it is the same column every other write to this
    // row touches.
    this.db
      .prepare(
        `INSERT INTO sys_dashboard_texture (id, app_wide, updated_at)
              VALUES (1, @appWide, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
              app_wide = excluded.app_wide,
              updated_at = excluded.updated_at`,
      )
      .run({ appWide: appWide ? 1 : 0 });
  }

  getTextureById(id: number): DashboardTextureItem | undefined {
    const row = this.db
      .prepare(
        `SELECT ${textureColumns("texture")}
           FROM sys_dashboard_textures AS texture
          WHERE texture.id = ?`,
      )
      .get(id) as TextureRow | undefined;

    return row ? toItem(row) : undefined;
  }
}
