import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleTextureRepository } from "./ports";
import type { ModuleTexture, ModuleTextureSettings } from "./types";

/**
 * Every column the settings read needs — and **not** `image`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB and the
 * read happens when a module shell renders. A `SELECT *` here would materialise
 * the whole picture on every page, for bytes only the serving route wants.
 * Presence is derived instead. Same rule as `MODULE_COLUMNS` and 0063's
 * `TEXTURE_COLUMNS`; see `migrations/0064_create_module_texture.md`.
 */
const TEXTURE_COLUMNS = `
  module_slug, opacity, mode, blur, updated_at,
  image IS NOT NULL AS has_image
`;

interface TextureRow {
  module_slug: string;
  opacity: number;
  mode: string;
  blur: number;
  updated_at: string;
  has_image: number;
}

/**
 * What a module with no row looks like.
 *
 * Unlike 0063 this table is deliberately unseeded — a missing row is the normal
 * state for most modules — so this is the common path, not an error path. Values
 * mirror the column defaults in migration 0064, so the moment a row *is* written
 * the answer doesn't jump.
 */
function textureFallback(moduleSlug: string): ModuleTexture {
  return {
    moduleSlug,
    hasImage: false,
    opacity: 0.1,
    mode: "cover",
    blur: 0,
    updatedAt: "",
  };
}

export class SqliteModuleTextureRepository implements ModuleTextureRepository {
  constructor(private db: Database.Database) {}

  getTexture(moduleSlug: string): ModuleTexture {
    const row = this.db
      .prepare(`SELECT ${TEXTURE_COLUMNS} FROM sys_module_texture WHERE module_slug = ?`)
      .get(moduleSlug) as TextureRow | undefined;
    if (!row) return textureFallback(moduleSlug);

    return {
      moduleSlug: row.module_slug,
      hasImage: row.has_image === 1,
      opacity: row.opacity,
      // Narrowed by the table's CHECK constraint, so the cast describes a
      // guarantee the schema already enforces rather than assuming one.
      mode: row.mode === "tile" ? "tile" : "cover",
      blur: row.blur,
      updatedAt: row.updated_at,
    };
  }

  getTextureImage(moduleSlug: string): DecodedImage | undefined {
    const row = this.db
      .prepare(`SELECT image, image_mime_type FROM sys_module_texture WHERE module_slug = ?`)
      .get(moduleSlug) as { image: Buffer | null; image_mime_type: string | null } | undefined;
    if (!row?.image || !row.image_mime_type) return undefined;
    return { data: row.image, mimeType: row.image_mime_type };
  }

  setImage(moduleSlug: string, image: DecodedImage | undefined): void {
    // An upsert, because this table has no seed row: the first upload for a
    // module is an INSERT and every later one an UPDATE. An UPDATE-only write
    // would silently affect nothing and report success.
    this.db
      .prepare(
        `INSERT INTO sys_module_texture (module_slug, image, image_mime_type, updated_at)
              VALUES (@moduleSlug, @data, @mimeType, datetime('now'))
         ON CONFLICT(module_slug) DO UPDATE SET
              image = excluded.image,
              image_mime_type = excluded.image_mime_type,
              -- Bumped so the <img> cache-buster changes and a replaced picture
              -- shows up immediately rather than after max-age expires.
              updated_at = excluded.updated_at`,
      )
      .run({ moduleSlug, data: image?.data ?? null, mimeType: image?.mimeType ?? null });
  }

  setSettings(moduleSlug: string, settings: ModuleTextureSettings): void {
    // Also an upsert: an admin can tune the knobs before uploading a picture,
    // which has to create the row rather than do nothing.
    this.db
      .prepare(
        `INSERT INTO sys_module_texture (module_slug, opacity, mode, blur, updated_at)
              VALUES (@moduleSlug, @opacity, @mode, @blur, datetime('now'))
         ON CONFLICT(module_slug) DO UPDATE SET
              opacity = excluded.opacity,
              mode = excluded.mode,
              blur = excluded.blur,
              updated_at = excluded.updated_at`,
      )
      .run({ moduleSlug, ...settings });
  }
}
