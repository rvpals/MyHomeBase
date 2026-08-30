import type { ColorThemeWrite, StoredColorTheme } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface ColorThemeRepository {
  /**
   * Every theme, in picker order.
   *
   * Read on every page render — the root layout resolves the active theme to emit the
   * `:root` custom properties. Cheap by construction: nine short text columns and a
   * table that holds tens of rows at most, no BLOBs.
   */
  list(): StoredColorTheme[];
  get(id: string): StoredColorTheme | undefined;
  /** Creates a user theme (`is_builtin = 0`). Throws if the id is taken. */
  insert(theme: ColorThemeWrite): void;
  /**
   * Overwrites an existing theme's colors, fonts, name and description.
   *
   * Works on built-ins too — that is the point of seeding them. Never changes
   * `is_builtin`, so a built-in stays resettable however often it is edited.
   */
  update(theme: ColorThemeWrite): void;
  remove(id: string): void;
}
