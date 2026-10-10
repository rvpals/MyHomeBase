/**
 * A navigation texture resolved for rendering: the picture's URL and how
 * strongly to draw it.
 *
 * Undefined rather than a zero-opacity texture is what the resolver returns for
 * "no picture", so the renderer can leave the `::before` layer off entirely
 * rather than painting a transparent one — the same reasoning
 * `ResolvedToolbarTexture` documents, and the same reason `ResolvedAppTexture`
 * makes `vars` optional.
 */
export interface ResolvedNavTexture {
  /** A CSS `url("…")`, cache-busted by the library row's `updatedAt`. */
  image: string;
  /** 0..1. The navigation's own value, not the library row's — see below. */
  opacity: number;
}

/**
 * The two settings rows that make up the navigation's texture.
 *
 * Stored in `sys_app_settings` rather than a table of their own: this is one
 * app-wide choice of two scalars, which is exactly what that table is for, and
 * it means the feature ships without a migration. The keys are
 * `nav_texture_id` and `nav_texture_opacity`.
 *
 * Both arrive as the strings the settings table stores. Parsing them is
 * `resolveNavTexture`'s job, not the caller's, so a blank, an absent row and a
 * malformed value all land in one place.
 */
export interface NavTextureSettings {
  /** The library picture id, as stored. Blank or absent means no texture. */
  id?: string;
  /** The strength, as stored. Absent or unparseable falls back to the default. */
  opacity?: string;
}
