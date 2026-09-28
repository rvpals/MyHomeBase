import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleTextureRepository } from "./ports";
import type {
  ModuleTexture,
  ModuleTextureSettings,
  ModuleTextureSource,
} from "./types";

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
  texture_id, texture_mode,
  image IS NOT NULL AS has_image
`;

interface TextureRow {
  module_slug: string;
  opacity: number;
  mode: string;
  blur: number;
  updated_at: string;
  texture_id: number | null;
  texture_mode: string;
  has_image: number;
}

/** Narrowed by the table's CHECK (0117), so this reads a guarantee. */
function toSource(value: string): ModuleTextureSource {
  return value === "library" || value === "own" || value === "none" ? value : "inherit";
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
    // A module with no row has never been configured, so it inherits — which is
    // both the column default in 0117 and the overwhelmingly common case.
    source: "inherit",
    textureId: undefined,
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
      source: toSource(row.texture_mode),
      textureId: row.texture_id ?? undefined,
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
        `INSERT INTO sys_module_texture
                (module_slug, image, image_mime_type, texture_mode, texture_id, updated_at)
              VALUES (@moduleSlug, @data, @mimeType, @mode, NULL, datetime('now'))
         ON CONFLICT(module_slug) DO UPDATE SET
              image = excluded.image,
              image_mime_type = excluded.image_mime_type,
              -- The mode moves with the bytes (0117), or an upload would land in
              -- a row still set to 'inherit' and never be drawn -- and removing
              -- a picture would leave 'own' pointing at nothing. Clearing
              -- texture_id alongside it keeps the two from disagreeing about
              -- which source is live.
              texture_mode = excluded.texture_mode,
              texture_id = excluded.texture_id,
              -- Bumped so the <img> cache-buster changes and a replaced picture
              -- shows up immediately rather than after max-age expires.
              updated_at = excluded.updated_at`,
      )
      .run({
        moduleSlug,
        data: image?.data ?? null,
        mimeType: image?.mimeType ?? null,
        // Removing the picture returns the module to the app-wide background
        // rather than to 'none': "I deleted my picture" is not "I want no
        // background anywhere". Choosing 'none' is a separate, explicit act.
        mode: image ? "own" : "inherit",
      });
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

  setChoice(moduleSlug: string, source: ModuleTextureSource, textureId?: number): void {
    // An upsert for the same reason the writers above use one: this table has no
    // seed row, so the first choice for a module is an INSERT.
    //
    // `image` is deliberately left alone. A module that uploaded a picture and
    // then picks a library one keeps its own bytes sitting in the row, so
    // switching back to 'own' restores it rather than requiring a re-upload. The
    // mode is what decides which is drawn, which is the whole point of 0117.
    this.db
      .prepare(
        `INSERT INTO sys_module_texture
                (module_slug, texture_mode, texture_id, updated_at)
              VALUES (@moduleSlug, @source, @textureId, datetime('now'))
         ON CONFLICT(module_slug) DO UPDATE SET
              texture_mode = excluded.texture_mode,
              texture_id = excluded.texture_id,
              updated_at = excluded.updated_at`,
      )
      .run({
        moduleSlug,
        source,
        // NULL unless a library picture was named, so a stale id cannot outlive
        // the choice that used it and resurface if the module later switches
        // back to 'library'.
        textureId: source === "library" ? (textureId ?? null) : null,
      });
  }

  listSlugsWithImage(): string[] {
    // Slugs alone: no BLOB is materialised, the same discipline TEXTURE_COLUMNS
    // follows above.
    //
    // Keyed on `texture_mode`, not on `image IS NOT NULL`, since 0117: what the
    // caller wants is "which modules do NOT inherit the app texture", and that
    // is now three modes rather than "has bytes". A module can override with a
    // library picture or with 'none' while holding no bytes of its own, and a
    // module holding bytes it isn't drawing does not override at all.
    const rows = this.db
      .prepare(
        `SELECT module_slug FROM sys_module_texture
          WHERE texture_mode <> 'inherit'
          ORDER BY module_slug`,
      )
      .all() as { module_slug: string }[];

    return rows.map((row) => row.module_slug);
  }
}
