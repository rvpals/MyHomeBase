import type Database from "better-sqlite3";
import type { IconOverridesRepository, IconOverrideWrite } from "./ports";
import type { IconOverride, IconOverrideImage } from "./types";

interface OverrideRow {
  slot_id: string;
  set_id: string;
  svg_body: string | null;
  svg_w: number | null;
  svg_h: number | null;
  image_mime: string | null;
  updated_at: string;
}

interface ImageRow {
  image_data: Buffer | null;
  image_mime: string | null;
}

function toDomain(row: OverrideRow): IconOverride {
  return {
    slotId: row.slot_id,
    setId: row.set_id,
    svgBody: row.svg_body ?? undefined,
    svgWidth: row.svg_w ?? undefined,
    svgHeight: row.svg_h ?? undefined,
    imageMimeType: row.image_mime ?? undefined,
    updatedAt: row.updated_at,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteIconOverridesRepository implements IconOverridesRepository {
  constructor(private db: Database.Database) {}

  /**
   * Whether migration 0066 has been applied to the database in front of us.
   *
   * Every other repository here assumes its table exists, and rightly so — the app is
   * migrated before it is run. This one cannot, because `listForSet` is called by the
   * ROOT LAYOUT, so it runs while prerendering every page in the build. On a database
   * that predates 0066 the missing table doesn't degrade one screen, it fails
   * `next build` outright, naming whichever page happened to render first.
   *
   * Cached after the first check: within one process the table cannot appear or vanish,
   * and this would otherwise run on every render.
   */
  private tableExists?: boolean;

  private hasTable(): boolean {
    if (this.tableExists === undefined) {
      this.tableExists =
        this.db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get("ico_slot_overrides") !== undefined;
    }
    return this.tableExists;
  }

  listForSet(setId: string): IconOverride[] {
    // No table yet means "nobody has overridden anything", which is the correct answer
    // for an unmigrated database — every slot falls back to its set's own glyph.
    if (!this.hasTable()) return [];

    // Every column EXCEPT image_data. This runs on each page render, so pulling the
    // BLOB here would read the raster bytes of every overridden icon just to decide
    // which ones exist.
    const rows = this.db
      .prepare(
        `SELECT slot_id, set_id, svg_body, svg_w, svg_h, image_mime, updated_at
           FROM ico_slot_overrides
          WHERE set_id = ?
          ORDER BY slot_id ASC`,
      )
      .all(setId) as OverrideRow[];
    return rows.map(toDomain);
  }

  getImage(slotId: string, setId: string): IconOverrideImage | undefined {
    // Same reasoning as listForSet: no table means no override to serve, so the route
    // answers 404 rather than 500. `upsert` and `remove` are deliberately NOT guarded —
    // a write that silently did nothing would look like a saved icon that never appears.
    if (!this.hasTable()) return undefined;

    const row = this.db
      .prepare(
        `SELECT image_data, image_mime FROM ico_slot_overrides
          WHERE slot_id = ? AND set_id = ?`,
      )
      .get(slotId, setId) as ImageRow | undefined;

    if (!row?.image_data || !row.image_mime) return undefined;
    return { data: row.image_data, mimeType: row.image_mime };
  }

  listAllImages(): { slotId: string; setId: string; data: Buffer; mimeType: string }[] {
    if (!this.hasTable()) return [];
    const rows = this.db
      .prepare(
        `SELECT slot_id, set_id, image_data, image_mime FROM ico_slot_overrides
          WHERE image_data IS NOT NULL AND image_mime IS NOT NULL
          ORDER BY set_id, slot_id`,
      )
      .all() as { slot_id: string; set_id: string; image_data: Buffer; image_mime: string }[];
    return rows.map((row) => ({
      slotId: row.slot_id,
      setId: row.set_id,
      data: row.image_data,
      mimeType: row.image_mime,
    }));
  }

  upsert(override: IconOverrideWrite): void {
    // A write on an unmigrated database must fail — but with something an admin can act
    // on. The raw driver error here is "no such table: ico_slot_overrides", which is true
    // and useless on an upload form.
    if (!this.hasTable()) {
      throw new Error(
        "Icon overrides need migration 0066 — run `npm run db:migrate` (or node migrate.cjs on the NAS).",
      );
    }

    // Every payload column is written on conflict, including the ones this call leaves
    // undefined. Replacing an SVG override with a raster one must null out the old
    // body — otherwise the row would carry both and violate the table's CHECK.
    this.db
      .prepare(
        `INSERT INTO ico_slot_overrides
           (slot_id, set_id, svg_body, svg_w, svg_h, image_data, image_mime, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slot_id, set_id) DO UPDATE SET
           svg_body   = excluded.svg_body,
           svg_w      = excluded.svg_w,
           svg_h      = excluded.svg_h,
           image_data = excluded.image_data,
           image_mime = excluded.image_mime,
           updated_at = excluded.updated_at`,
      )
      .run(
        override.slotId,
        override.setId,
        override.svgBody ?? null,
        override.svgWidth ?? null,
        override.svgHeight ?? null,
        override.imageData ?? null,
        override.imageMimeType ?? null,
        override.updatedAt,
      );
  }

  remove(slotId: string, setId: string): void {
    this.db
      .prepare("DELETE FROM ico_slot_overrides WHERE slot_id = ? AND set_id = ?")
      .run(slotId, setId);
  }
}
