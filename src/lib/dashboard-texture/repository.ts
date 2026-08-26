import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DashboardTextureRepository } from "./ports";
import type { DashboardTexture, DashboardTextureSettings } from "./types";

/**
 * Every column the settings read needs — and **not** `image`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB and the
 * root layout reads it on every authenticated page. A `SELECT *` here would
 * materialise the whole picture on every render, for bytes only the serving
 * route wants. Presence is derived instead, so the layout can decide whether to
 * emit a texture layer for free. Same rule as `MODULE_COLUMNS`; see
 * `migrations/0063_create_dashboard_texture.md`.
 */
const TEXTURE_COLUMNS = `
  opacity, mode, blur, updated_at,
  image IS NOT NULL AS has_image
`;

interface TextureRow {
  opacity: number;
  mode: string;
  blur: number;
  updated_at: string;
  has_image: number;
}

/**
 * What a fresh install looks like before the seed row is read — and what a
 * database whose row somehow went missing falls back to.
 *
 * Mirrors the column defaults in migration 0063. Without it, `getTexture()`
 * would have to return `undefined` and every caller would need a branch for a
 * state that means nothing more than "no picture yet".
 */
const TEXTURE_FALLBACK: DashboardTexture = {
  hasImage: false,
  opacity: 0.1,
  mode: "cover",
  blur: 0,
  updatedAt: "",
};

export class SqliteDashboardTextureRepository implements DashboardTextureRepository {
  constructor(private db: Database.Database) {}

  getTexture(): DashboardTexture {
    const row = this.db
      .prepare(`SELECT ${TEXTURE_COLUMNS} FROM sys_dashboard_texture WHERE id = 1`)
      .get() as TextureRow | undefined;
    if (!row) return TEXTURE_FALLBACK;

    return {
      hasImage: row.has_image === 1,
      opacity: row.opacity,
      // Narrowed by the table's CHECK constraint, so the cast is describing a
      // guarantee the schema already enforces rather than assuming one.
      mode: row.mode === "tile" ? "tile" : "cover",
      blur: row.blur,
      updatedAt: row.updated_at,
    };
  }

  getTextureImage(): DecodedImage | undefined {
    const row = this.db
      .prepare(`SELECT image, image_mime_type FROM sys_dashboard_texture WHERE id = 1`)
      .get() as { image: Buffer | null; image_mime_type: string | null } | undefined;
    if (!row?.image || !row.image_mime_type) return undefined;
    return { data: row.image, mimeType: row.image_mime_type };
  }

  setImage(image: DecodedImage | undefined): void {
    // An upsert, not an UPDATE. The migration seeds row 1, so in practice the
    // row is there — but an UPDATE against a missing row affects nothing and
    // reports success, which is the failure `requireModule` exists to prevent on
    // the modules side. Here the row's identity is a constant, so the write can
    // simply guarantee it.
    this.db
      .prepare(
        `INSERT INTO sys_dashboard_texture (id, image, image_mime_type, updated_at)
              VALUES (1, @data, @mimeType, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
              image = excluded.image,
              image_mime_type = excluded.image_mime_type,
              -- Bumped so the <img> cache-buster changes and a replaced picture
              -- shows up immediately rather than after max-age expires.
              updated_at = excluded.updated_at`,
      )
      .run({ data: image?.data ?? null, mimeType: image?.mimeType ?? null });
  }

  setSettings(settings: DashboardTextureSettings): void {
    this.db
      .prepare(
        `INSERT INTO sys_dashboard_texture (id, opacity, mode, blur, updated_at)
              VALUES (1, @opacity, @mode, @blur, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
              opacity = excluded.opacity,
              mode = excluded.mode,
              blur = excluded.blur,
              updated_at = excluded.updated_at`,
      )
      .run(settings);
  }
}
