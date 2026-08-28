// The domain types for slot-based icon overrides.
//
// A *slot* is a named place in the application that shows an icon
// ("homescreen_card_daily_quote"). A *concept* is the semantic glyph name the
// existing icon sets are keyed by ("quote"). Every slot declares a default
// concept, so a slot with no override resolves to exactly what the app rendered
// before slots existed.

/** Which glyph table a slot's default concept is looked up in. */
export type IconNamespace = "tree" | "module";

/**
 * One icon position in the app. Code-registered, not user-created: a slot only
 * exists because some call site reads it, so the registry in slots.ts is the
 * single queryable map of where this app shows icons.
 */
export interface IconSlot {
  /** Stable id, `<area>_<kind>_<name>`. Written to the database — renaming needs a migration. */
  id: string;
  /** Human label for the admin list, e.g. "Daily Quote card". */
  label: string;
  /** Grouping header for the admin list, e.g. "Home screen". */
  group: string;
  /**
   * Where to actually find this icon on screen, in plain English — the click path and the
   * spot within it ("Home screen → Daily Quote card, left of the title").
   *
   * `label` names the slot; this says how to *get there*. Without it a list of forty-odd
   * positions is a guessing game: several read almost identically out of context (every
   * module has a "Dashboard" section), and after uploading an icon the first thing you
   * want is to go look at it.
   */
  where: string;
  /**
   * Whether the call site actually reads this slot yet.
   *
   * A registered-but-unwired slot is inert: it still renders its default concept, because
   * the screen is calling `TreeIcon` directly. Recorded so the admin list can say so — an
   * upload that silently does nothing is a worse experience than a row marked "not yet
   * wired up". Drop the flag (or set it true) as each call site is converted.
   */
  wired?: boolean;
  /** The glyph used when nothing is overridden. Must exist in `namespace`'s table. */
  defaultConcept: string;
  namespace: IconNamespace;
}

/**
 * A user-supplied glyph for one slot under one icon set.
 *
 * Exactly one of the two payloads is present. SVG is stored as a sanitized inner
 * body so it can be inlined and inherit `currentColor` (theme-tintable); raster
 * bytes are served by a route and can never tint.
 */
export interface IconOverride {
  slotId: string;
  setId: string;
  /** Sanitized inner SVG markup — no outer <svg> element, no script, no external refs. */
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  imageMimeType?: string;
  /** ISO timestamp; the serving route's `?v=` cache-buster. */
  updatedAt: string;
}

/** An override plus its bytes. Only the serving route needs the BLOB. */
export interface IconOverrideImage {
  data: Buffer;
  mimeType: string;
}

/** What `SlotIcon` needs to render one slot, with the bytes left behind. */
export type IconOverrideMap = Record<string, IconOverride>;
