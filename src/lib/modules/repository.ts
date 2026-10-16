import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ModuleIconName } from "./icon-names";
import { moduleSchema, type ModuleUpdate } from "./schema";
import type {
  Module,
  ModuleCustomIcon,
  ModuleCustomIconSummary,
  ModuleSeed,
} from "./types";
import type { ModuleRepository } from "./ports";

/**
 * Every column a module read needs — and **not** `carousel_image`, `custom_icon`
 * or `custom_icon_svg`.
 *
 * Spelled out rather than `SELECT *` because this table carries a BLOB and is
 * the most-read table in the app: `listModules` runs in the protected layout and
 * `getModuleBySlug` on every module route. A `SELECT *` here would materialise a
 * multi-megabyte image on every page render. Presence is derived instead, so the
 * carousel can choose between artwork and glyph for free, and every nav can
 * choose between an upload and a glyph for free.
 *
 * `custom_icon_svg` is excluded for the same reason even though it is only a few
 * KB of text: there is no render path that needs the markup inline, and this
 * list runs on every page. The serving route reads it, nothing else.
 */
const MODULE_COLUMNS = `
  id, slug, short_name, long_name, description, sequence, is_visible, icon, updated_at,
  carousel_image IS NOT NULL AS has_carousel_image,
  custom_icon IS NOT NULL AS has_custom_icon_image,
  custom_icon_svg IS NOT NULL AS has_custom_icon_svg
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
  has_custom_icon_image: number;
  has_custom_icon_svg: number;
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
    hasCustomIcon: row.has_custom_icon_image === 1 || row.has_custom_icon_svg === 1,
    // SVG wins if both columns somehow hold a value. They never should —
    // `setCustomIcon` writes one and nulls the other in the same statement — but
    // a renderer has to pick deterministically, and the SVG is the better icon:
    // it tints with `currentColor` where the raster cannot.
    customIconKind:
      row.has_custom_icon_svg === 1 ? "svg" : row.has_custom_icon_image === 1 ? "image" : undefined,
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

  // Also selects the BLOB, and also has exactly one caller: the resize backfill
  // CLI. Ordered by slug so a dry run and the real run report in the same order.
  listAllCarouselImages(): { slug: string; data: Buffer; mimeType: string }[] {
    const rows = this.db
      .prepare(
        `SELECT slug,
                carousel_image AS data,
                carousel_image_mime_type AS mimeType
           FROM sys_modules
          WHERE carousel_image IS NOT NULL
            AND carousel_image_mime_type IS NOT NULL
          ORDER BY slug ASC`,
      )
      .all() as { slug: string; data: Buffer | null; mimeType: string | null }[];

    return rows.flatMap((row) =>
      row.data && row.mimeType ? [{ slug: row.slug, data: row.data, mimeType: row.mimeType }] : [],
    );
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

  // The other query that selects a payload column, and the other one with a
  // single caller: the icon serving route. Everything that *renders* a module
  // icon reads `hasCustomIcon`/`customIconKind` off MODULE_COLUMNS instead.
  getCustomIcon(slug: string): ModuleCustomIcon | undefined {
    const row = this.db
      .prepare(
        `SELECT custom_icon AS data,
                custom_icon_mime_type AS mimeType,
                custom_icon_svg AS svgBody,
                custom_icon_width AS svgWidth,
                custom_icon_height AS svgHeight
           FROM sys_modules
          WHERE slug = ?`,
      )
      .get(slug) as
      | {
          data: Buffer | null;
          mimeType: string | null;
          svgBody: string | null;
          svgWidth: number | null;
          svgHeight: number | null;
        }
      | undefined;

    if (!row) return undefined;
    // Checked in the same order `toDomain` picks `customIconKind`, so the route
    // can never serve a payload the nav isn't expecting.
    if (row.svgBody) {
      return {
        svgBody: row.svgBody,
        svgWidth: row.svgWidth ?? undefined,
        svgHeight: row.svgHeight ?? undefined,
      };
    }
    if (row.data && row.mimeType) return { data: row.data, mimeType: row.mimeType };
    return undefined;
  }

  // Runs once per authenticated page render, so it is written to be cheap in the
  // case that matters: with no uploads anywhere it returns no rows. `custom_icon`
  // is NOT selected — only whether it is there — because the bytes belong to the
  // serving route. `custom_icon_svg` IS selected, because inlining the markup is
  // the only way a custom glyph can tint with `currentColor`.
  listCustomIcons(): ModuleCustomIconSummary[] {
    const rows = this.db
      .prepare(
        `SELECT slug,
                custom_icon_svg AS svgBody,
                custom_icon_width AS svgWidth,
                custom_icon_height AS svgHeight,
                custom_icon IS NOT NULL AS hasImage,
                updated_at AS version
           FROM sys_modules
          WHERE custom_icon IS NOT NULL
             OR custom_icon_svg IS NOT NULL
          ORDER BY slug ASC`,
      )
      .all() as {
      slug: string;
      svgBody: string | null;
      svgWidth: number | null;
      svgHeight: number | null;
      hasImage: number;
      version: string | null;
    }[];

    // The type argument is explicit because `flatMap` infers the callback's
    // return from the first branch alone, which would reject the image arm.
    return rows.flatMap<ModuleCustomIconSummary>((row) => {
      // Same precedence as `toDomain`: SVG wins, so the two can never disagree
      // about what a given module is going to draw.
      if (row.svgBody) {
        return [
          {
            slug: row.slug,
            kind: "svg" as const,
            svgBody: row.svgBody,
            svgWidth: row.svgWidth ?? undefined,
            svgHeight: row.svgHeight ?? undefined,
          },
        ];
      }
      if (row.hasImage === 1) {
        return [{ slug: row.slug, kind: "image" as const, version: row.version ?? undefined }];
      }
      return [];
    });
  }

  setCustomIcon(slug: string, icon: ModuleCustomIcon | undefined): void {
    this.db
      .prepare(
        `UPDATE sys_modules
            SET custom_icon = @data,
                custom_icon_mime_type = @mimeType,
                custom_icon_svg = @svgBody,
                custom_icon_width = @svgWidth,
                custom_icon_height = @svgHeight,
                -- Bumped so the <img> cache-buster changes and a replaced icon
                -- shows up immediately. The route sends immutable, so without
                -- this a replacement would never be fetched at all.
                updated_at = datetime('now')
          WHERE slug = @slug`,
      )
      // Every column is written on every call, including the nulls: that is what
      // keeps "exactly one payload" true without a CHECK constraint, and what
      // makes `undefined` clear the icon rather than half-clear it.
      .run({
        slug,
        data: icon?.data ?? null,
        mimeType: icon?.mimeType ?? null,
        svgBody: icon?.svgBody ?? null,
        svgWidth: icon?.svgWidth ?? null,
        svgHeight: icon?.svgHeight ?? null,
      });
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
