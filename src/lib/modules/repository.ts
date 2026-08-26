import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleIconName } from "./icon-names";
import { moduleSchema, type ModuleUpdate } from "./schema";
import type { Module, ModuleSeed } from "./types";
import type { ModuleRepository } from "./ports";

/**
 * Every column a module read needs — and **not** `carousel_image`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB and is
 * the most-read table in the app: `listModules` runs in the protected layout and
 * `getModuleBySlug` on every module route. A `SELECT *` here would materialise a
 * multi-megabyte image on every page render. Presence is derived instead, so the
 * carousel can choose between artwork and glyph for free.
 */
const MODULE_COLUMNS = `
  id, slug, short_name, long_name, description, sequence, is_visible, icon, updated_at,
  carousel_image IS NOT NULL AS has_carousel_image
`;

interface ModuleRow {
  id: number;
  slug: string;
  short_name: string;
  long_name: string;
  description: string | null;
  sequence: number;
  is_visible: number;
  icon: string;
  updated_at: string | null;
  has_carousel_image: number;
}

function toDomain(row: ModuleRow): Module {
  return moduleSchema.parse({
    id: row.id,
    slug: row.slug,
    shortName: row.short_name,
    longName: row.long_name,
    description: row.description ?? undefined,
    sequence: row.sequence,
    isVisible: row.is_visible === 1,
    icon: row.icon,
    hasCarouselImage: row.has_carousel_image === 1,
    updatedAt: row.updated_at ?? undefined,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteModuleRepository implements ModuleRepository {
  constructor(private db: Database.Database) {}

  listModules(options: { includeHidden?: boolean } = {}): Module[] {
    const query = options.includeHidden
      ? `SELECT ${MODULE_COLUMNS} FROM sys_modules ORDER BY sequence ASC`
      : `SELECT ${MODULE_COLUMNS} FROM sys_modules WHERE is_visible = 1 ORDER BY sequence ASC`;
    const rows = this.db.prepare(query).all() as ModuleRow[];
    return rows.map(toDomain);
  }

  getModuleBySlug(slug: string): Module | undefined {
    const row = this.db
      .prepare(`SELECT ${MODULE_COLUMNS} FROM sys_modules WHERE slug = ?`)
      .get(slug) as ModuleRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  updateAll(updates: ModuleUpdate[]): void {
    const stmt = this.db.prepare(
      "UPDATE sys_modules SET short_name = ?, long_name = ?, description = ?, is_visible = ?, sequence = ? WHERE slug = ?",
    );
    const applyUpdates = this.db.transaction((items: ModuleUpdate[]) => {
      items.forEach((item, index) => {
        stmt.run(
          item.shortName,
          item.longName,
          item.description ?? null,
          item.isVisible ? 1 : 0,
          index + 1,
          item.slug,
        );
      });
    });
    applyUpdates(updates);
  }

  // The only query in the app that selects the BLOB. Called by the serving
  // route; calling it from anywhere that renders a list defeats the point of
  // MODULE_COLUMNS above.
  getCarouselImage(slug: string): DecodedImage | undefined {
    const row = this.db
      .prepare(
        "SELECT carousel_image AS data, carousel_image_mime_type AS mimeType FROM sys_modules WHERE slug = ?",
      )
      .get(slug) as { data: Buffer | null; mimeType: string | null } | undefined;

    if (!row?.data || !row.mimeType) return undefined;
    return { data: row.data, mimeType: row.mimeType };
  }

  setIcon(slug: string, icon: ModuleIconName): void {
    this.db
      .prepare(
        `UPDATE sys_modules
            SET icon = @icon,
                updated_at = datetime('now')
          WHERE slug = @slug`,
      )
      .run({ slug, icon });
  }

  setCarouselImage(slug: string, image: DecodedImage | undefined): void {
    this.db
      .prepare(
        `UPDATE sys_modules
            SET carousel_image = @data,
                carousel_image_mime_type = @mimeType,
                -- Bumped so the <img> cache-buster changes and a replaced image
                -- shows up immediately rather than after max-age expires.
                updated_at = datetime('now')
          WHERE slug = @slug`,
      )
      .run({ slug, data: image?.data ?? null, mimeType: image?.mimeType ?? null });
  }

  resetToDefaults(defaults: ModuleSeed[]): void {
    // Upsert by slug rather than delete-then-insert: modules that stay in the
    // defaults list keep their id, so module_settings rows (keyed by module_id,
    // no FK) don't get orphaned by a reset. Only modules dropped from the
    // defaults list are actually deleted.
    const upsert = this.db.prepare(`
      INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
      VALUES (@slug, @shortName, @longName, @description, @sequence, @isVisible, @icon)
      ON CONFLICT(slug) DO UPDATE SET
        short_name = excluded.short_name,
        long_name = excluded.long_name,
        description = excluded.description,
        sequence = excluded.sequence,
        is_visible = excluded.is_visible,
        icon = excluded.icon
    `);
    const deleteBySlug = this.db.prepare("DELETE FROM sys_modules WHERE slug = ?");

    const applyReset = this.db.transaction((items: ModuleSeed[]) => {
      const defaultSlugs = new Set(items.map((item) => item.slug));
      const existingSlugs = (
        this.db.prepare("SELECT slug FROM sys_modules").all() as { slug: string }[]
      ).map((row) => row.slug);

      for (const slug of existingSlugs) {
        if (!defaultSlugs.has(slug)) deleteBySlug.run(slug);
      }

      items.forEach((item, index) => {
        upsert.run({
          slug: item.slug,
          shortName: item.shortName,
          longName: item.longName,
          description: item.description ?? null,
          sequence: index + 1,
          isVisible: item.isVisible ? 1 : 0,
          icon: item.icon,
        });
      });
    });
    applyReset(defaults);
  }
}
