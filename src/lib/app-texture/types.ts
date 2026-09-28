/**
 * Which of the app's two texture sources a screen ended up drawing.
 *
 * Returned alongside the CSS so a caller can explain the outcome — the admin
 * screen says "the Music Library is overriding this" — without re-deriving the
 * precedence rule and risking the two disagreeing.
 */
export type AppTextureSource = "module" | "app" | "none";

/**
 * What one screen should draw behind its content.
 *
 * `vars` is `undefined` for `"none"`, which is what lets the caller skip the
 * layer element entirely rather than rendering one at opacity 0 — an always-on
 * `fixed` pseudo-element costs a compositing layer on every scroll for nothing.
 * That was the reasoning the two modules' own `cssVars` helpers followed before
 * this module absorbed them; the type just makes it explicit.
 */
export interface ResolvedAppTexture {
  source: AppTextureSource;
  /** The custom properties for the layer, or `undefined` when there is none. */
  vars?: Record<string, string>;
}
