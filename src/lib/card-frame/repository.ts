import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { CardFrameRepository } from "./ports";
import type { CardFrame, CardFrameSelection, CardFrameSettings } from "./types";

/**
 * Every column a frame read needs — and **not** `image`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB per row.
 * A `SELECT *` would materialise every frame's bytes on an admin render, for
 * data only the serving route wants. Presence is derived instead. Same rule as
 * `textureColumns`; see `migrations/0133_create_card_frames.md`.
 *
 * Takes the table's alias because `getSelection()` joins the library to the
 * selection singleton and the two share `id` *and* `updated_at` — unqualified,
 * SQLite rejects the query with "ambiguous column name".
 */
const frameColumns = (alias: string) => `
  ${alias}.id, ${alias}.name,
  ${alias}.slice_top, ${alias}.slice_right, ${alias}.slice_bottom, ${alias}.slice_left,
  ${alias}.fill_opacity, ${alias}.fill_mode, ${alias}.center_fill,
  ${alias}.updated_at, ${alias}.image IS NOT NULL AS has_image
`;

interface FrameRow {
  id: number;
  name: string;
  slice_top: number;
  slice_right: number;
  slice_bottom: number;
  slice_left: number;
  fill_opacity: number;
  fill_mode: string;
  center_fill: number;
  updated_at: string;
  has_image: number;
}

function toFrame(row: FrameRow): CardFrame {
  return {
    id: row.id,
    name: row.name,
    hasImage: row.has_image === 1,
    insets: {
      top: row.slice_top,
      right: row.slice_right,
      bottom: row.slice_bottom,
      left: row.slice_left,
    },
    fillOpacity: row.fill_opacity,
    // The CHECK constrains this to the three known values, so the cast is
    // describing a guarantee the table already enforces rather than hiding a
    // widening — the same shape the texture repositories use for `mode`.
    fill: row.fill_mode as CardFrame["fill"],
    centerFill: row.center_fill === 1,
    updatedAt: row.updated_at,
  };
}

export class SqliteCardFrameRepository implements CardFrameRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * An INNER JOIN, so a selection pointing at a deleted frame yields no row and
   * falls through to "no frame" — rather than a half-populated object naming an
   * id that no longer exists. Same guard `getTexture()` uses.
   */
  getSelection(): CardFrameSelection {
    const row = this.db
      .prepare(
        `SELECT ${frameColumns("frame")}
         FROM sys_card_frame AS selection
         JOIN sys_card_frames AS frame ON frame.id = selection.selected_frame_id
         WHERE selection.id = 1`,
      )
      .get() as FrameRow | undefined;
    return row ? { frame: toFrame(row) } : {};
  }

  listFrames(): CardFrame[] {
    const rows = this.db
      .prepare(
        `SELECT ${frameColumns("frame")} FROM sys_card_frames AS frame
         ORDER BY frame.sort_order, frame.id`,
      )
      .all() as FrameRow[];
    return rows.map(toFrame);
  }

  getFrameById(id: number): CardFrame | undefined {
    const row = this.db
      .prepare(`SELECT ${frameColumns("frame")} FROM sys_card_frames AS frame WHERE frame.id = ?`)
      .get(id) as FrameRow | undefined;
    return row ? toFrame(row) : undefined;
  }

  /** The only read that touches a BLOB. */
  getFrameImage(id?: number): DecodedImage | undefined {
    const row = (
      id === undefined
        ? this.db
            .prepare(
              `SELECT frame.image, frame.image_mime_type
               FROM sys_card_frame AS selection
               JOIN sys_card_frames AS frame ON frame.id = selection.selected_frame_id
               WHERE selection.id = 1`,
            )
            .get()
        : this.db
            .prepare(`SELECT image, image_mime_type FROM sys_card_frames WHERE id = ?`)
            .get(id)
    ) as { image: Buffer; image_mime_type: string } | undefined;
    return row ? { data: row.image, mimeType: row.image_mime_type } : undefined;
  }

  addFrame(name: string, image: DecodedImage, settings: CardFrameSettings): number {
    const result = this.db
      .prepare(
        `INSERT INTO sys_card_frames
           (name, image, image_mime_type,
            slice_top, slice_right, slice_bottom, slice_left,
            fill_opacity, fill_mode, center_fill, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sys_card_frames),
                 datetime('now'))`,
      )
      .run(
        name,
        image.data,
        image.mimeType,
        settings.insets.top,
        settings.insets.right,
        settings.insets.bottom,
        settings.insets.left,
        settings.fillOpacity,
        settings.fill,
        settings.centerFill ? 1 : 0,
      );
    return Number(result.lastInsertRowid);
  }

  replaceFrameImage(id: number, image: DecodedImage): boolean {
    const result = this.db
      .prepare(
        `UPDATE sys_card_frames
         SET image = ?, image_mime_type = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(image.data, image.mimeType, id);
    return result.changes > 0;
  }

  renameFrame(id: number, name: string): boolean {
    const result = this.db
      .prepare(`UPDATE sys_card_frames SET name = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, id);
    return result.changes > 0;
  }

  /**
   * A transaction: deleting the *selected* frame must also clear the selection,
   * or the next read joins against a missing row. Same pair `deleteTexture`
   * performs.
   */
  deleteFrame(id: number): boolean {
    const run = this.db.transaction((frameId: number) => {
      const result = this.db.prepare(`DELETE FROM sys_card_frames WHERE id = ?`).run(frameId);
      if (result.changes === 0) return false;
      this.db
        .prepare(
          `UPDATE sys_card_frame SET selected_frame_id = NULL, updated_at = datetime('now')
           WHERE id = 1 AND selected_frame_id = ?`,
        )
        .run(frameId);
      return true;
    });
    return run(id);
  }

  /**
   * An upsert on id = 1, not an UPDATE: a missing seed row would make an UPDATE
   * succeed while changing nothing, and the admin would see their selection
   * silently fail to stick.
   */
  selectFrame(id: number | undefined): boolean {
    // Selecting nothing is how frames are turned off, so it is always valid —
    // only a selection naming a frame has to name one that exists.
    if (id !== undefined) {
      const exists = this.db
        .prepare(`SELECT 1 AS present FROM sys_card_frames WHERE id = ?`)
        .get(id) as { present: number } | undefined;
      if (!exists) return false;
    }
    this.db
      .prepare(
        `INSERT INTO sys_card_frame (id, selected_frame_id, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE
           SET selected_frame_id = excluded.selected_frame_id,
               updated_at = excluded.updated_at`,
      )
      .run(id ?? null);
    return true;
  }

  setSettings(id: number, settings: CardFrameSettings): boolean {
    const result = this.db
      .prepare(
        `UPDATE sys_card_frames
         SET slice_top = ?, slice_right = ?, slice_bottom = ?, slice_left = ?,
             fill_opacity = ?, fill_mode = ?, center_fill = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        settings.insets.top,
        settings.insets.right,
        settings.insets.bottom,
        settings.insets.left,
        settings.fillOpacity,
        settings.fill,
        settings.centerFill ? 1 : 0,
        id,
      );
    return result.changes > 0;
  }
}
