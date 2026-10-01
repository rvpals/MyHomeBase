export interface Setting {
  key: string;
  value: string;
  description?: string;
}

/**
 * The border treatment for the app's chrome — the utility header and the
 * desktop navigation tree. Stored in the `chrome_style` setting
 * (migrations/0121); the catalogue and the resolver live in ./chrome-style.
 *
 * Permanent ids: each is selected on by a `html[data-chrome-style="…"]` rule in
 * globals.css and stored per install, so renaming one drops an admin's choice.
 */
export type ChromeStyle = "current" | "inset" | "outset" | "emboss";

/**
 * The three independently adjustable border weights, in whole pixels. Stored in
 * the `border_widths` setting (migrations/0122) as `outline=1,divider=1,line=1`;
 * the catalogue, bounds and encoding live in ./border-widths.
 *
 * Permanent keys: they are the stored encoding, so renaming one drops that axis
 * back to its default on every install that had set it.
 */
export interface BorderWidths {
  /** The chrome's outer edges: header rule, tree column rule, slab outlines. */
  outline: number;
  /** Rules inside the navigation column: filter underline, group boxes. */
  divider: number;
  /** Every other `--line` border, app-wide. */
  line: number;
}
