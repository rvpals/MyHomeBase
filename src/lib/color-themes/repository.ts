import type Database from "better-sqlite3";
import type { FontKey } from "@/lib/settings";
import type { ColorThemeRepository } from "./ports";
import type { ColorThemeWrite, StoredColorTheme } from "./types";

interface ThemeRow {
  id: string;
  name: string;
  description: string;
  paper: string;
  paper_raised: string;
  ink: string;
  line: string;
  muted: string;
  muted_inverse: string;
  brass: string;
  brass_dark: string;
  brass_soft: string;
  font_display: string;
  font_body: string;
  font_mono: string;
  is_builtin: number;
  sort_order: number;
  updated_at: string;
}

const THEME_COLUMNS = `
  id, name, description,
  paper, paper_raised, ink, line, muted, muted_inverse,
  brass, brass_dark, brass_soft,
  font_display, font_body, font_mono,
  is_builtin, sort_order, updated_at
`;

function toDomain(row: ThemeRow): StoredColorTheme {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tokens: {
      paper: row.paper,
      paperRaised: row.paper_raised,
      ink: row.ink,
      line: row.line,
      muted: row.muted,
      mutedInverse: row.muted_inverse,
      brass: row.brass,
      brassDark: row.brass_dark,
      brassSoft: row.brass_soft,
      // Cast rather than validated: the use-case layer checks font membership on every
      // write, so a row can only hold a key that was a FontKey when it was stored. A
      // key later removed from the union renders as the browser fallback, which is the
      // same outcome as any other unloaded font — not worth a per-render check on a
      // path the root layout takes.
      fonts: {
        display: row.font_display as FontKey,
        body: row.font_body as FontKey,
        mono: row.font_mono as FontKey,
      },
    },
    isBuiltin: row.is_builtin === 1,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

/** The write parameters, shared by insert and update. */
function toParams(theme: ColorThemeWrite) {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    paper: theme.tokens.paper,
    paperRaised: theme.tokens.paperRaised,
    ink: theme.tokens.ink,
    line: theme.tokens.line,
    muted: theme.tokens.muted,
    mutedInverse: theme.tokens.mutedInverse,
    brass: theme.tokens.brass,
    brassDark: theme.tokens.brassDark,
    brassSoft: theme.tokens.brassSoft,
    fontDisplay: theme.tokens.fonts.display,
    fontBody: theme.tokens.fonts.body,
    fontMono: theme.tokens.fonts.mono,
    sortOrder: theme.sortOrder,
  };
}

const MIGRATION_HINT =
  "Color themes need migration 0076 — run `npm run db:migrate` (or node migrate.cjs on the NAS).";

// The real repository. Swap the database without touching any use-case.
export class SqliteColorThemeRepository implements ColorThemeRepository {
  constructor(private db: Database.Database) {}

  /**
   * Whether migration 0076 has been applied to the database in front of us.
   *
   * The same guard `SqliteIconOverridesRepository` carries, for the same reason: `list`
   * is called by the ROOT LAYOUT to resolve the active theme, so it runs while
   * prerendering every page in the build. On a database predating 0076 a missing table
   * would not degrade one screen — it would fail `next build` outright, naming whichever
   * page rendered first.
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
          .get("sys_color_themes") !== undefined;
    }
    return this.tableExists;
  }

  list(): StoredColorTheme[] {
    // No table yet means "no themes stored", which `listColorThemes` turns into the eight
    // code-defined built-ins — so an unmigrated database renders the app it always did.
    if (!this.hasTable()) return [];

    const rows = this.db
      .prepare(
        `SELECT ${THEME_COLUMNS} FROM sys_color_themes
          ORDER BY sort_order ASC, name ASC`,
      )
      .all() as ThemeRow[];
    return rows.map(toDomain);
  }

  get(id: string): StoredColorTheme | undefined {
    if (!this.hasTable()) return undefined;

    const row = this.db
      .prepare(`SELECT ${THEME_COLUMNS} FROM sys_color_themes WHERE id = ?`)
      .get(id) as ThemeRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  // `insert`, `update` and `remove` are deliberately NOT guarded with a silent fallback —
  // a write that quietly did nothing would look like a saved theme that never appears.
  insert(theme: ColorThemeWrite): void {
    if (!this.hasTable()) throw new Error(MIGRATION_HINT);

    // is_builtin is not a parameter: this method only ever creates USER themes. The eight
    // built-ins are seeded by the migration, and `resetBuiltinTheme` reaches them through
    // `update`. Hardcoding 0 here means no caller can mint a fake built-in.
    this.db
      .prepare(
        `INSERT INTO sys_color_themes
           (id, name, description, paper, paper_raised, ink, line, muted, muted_inverse,
            brass, brass_dark, brass_soft, font_display, font_body, font_mono,
            is_builtin, sort_order)
         VALUES
           (@id, @name, @description, @paper, @paperRaised, @ink, @line, @muted, @mutedInverse,
            @brass, @brassDark, @brassSoft, @fontDisplay, @fontBody, @fontMono,
            0, @sortOrder)`,
      )
      .run(toParams(theme));
  }

  update(theme: ColorThemeWrite): void {
    if (!this.hasTable()) throw new Error(MIGRATION_HINT);

    // `is_builtin` is absent from the SET list on purpose — editing a built-in must not
    // demote it, or it would lose its reset path. `updated_at` is left to the trigger.
    const result = this.db
      .prepare(
        `UPDATE sys_color_themes SET
            name = @name, description = @description,
            paper = @paper, paper_raised = @paperRaised, ink = @ink, line = @line,
            muted = @muted, muted_inverse = @mutedInverse,
            brass = @brass, brass_dark = @brassDark, brass_soft = @brassSoft,
            font_display = @fontDisplay, font_body = @fontBody, font_mono = @fontMono,
            sort_order = @sortOrder
          WHERE id = @id`,
      )
      .run(toParams(theme));

    // An UPDATE against a missing row affects nothing and reports success. The use-case
    // checks existence first, so reaching this means the row vanished mid-request.
    if (result.changes === 0) {
      throw new Error(`No theme with the id "${theme.id}".`);
    }
  }

  remove(id: string): void {
    if (!this.hasTable()) throw new Error(MIGRATION_HINT);
    this.db.prepare("DELETE FROM sys_color_themes WHERE id = ?").run(id);
  }
}
