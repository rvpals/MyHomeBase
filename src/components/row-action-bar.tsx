// A small bar of icon-only actions that floats over the row it belongs to,
// revealed on hover.
//
// The point of it is space: four labelled buttons cost a whole table column, and
// that column is dead weight on every row the reader is not currently pointing at.
// Docking the same four to the hovered row buys the column back without hiding the
// actions behind a menu.
//
// NOT a floating component in the shell's sense (`FLOATING_COMPONENTS` /
// `FloatingLayer`). `design.md` → *The floating layer* governs the app's four
// reader-switchable surfaces — a clock, a calculator, that kind of thing. This is a
// control on an existing surface, scoped to one row, with no reader-facing switch
// and no persisted id. Same call `PersonalToolbar`'s ✎ edit shortcut makes.

import { type ReactNode } from "react";

export interface RowAction {
  /** Stable key within the bar. Not persisted anywhere — a React key only. */
  key: string;
  /** The glyph. Sized by the bar, so pass an icon that honours `className`. */
  icon: ReactNode;
  /**
   * The hint. Shown as the native tooltip **and** used as the accessible name,
   * because an icon-only button reads as nothing to a screen reader.
   *
   * Write the whole sentence a reader needs, naming the record — "Edit
   * “Tax return 2024”", not "Edit". The bar floats over a list, so by the
   * time the tooltip appears the pointer is the only thing saying which row it
   * belongs to.
   */
  hint: string;
  /** Runs the action. Ignored when `href` is set. */
  onClick?: () => void;
  /** Renders a real link instead of a button — for a download or a navigation. */
  href?: string;
  /**
   * Draws in the destructive colour. One per bar at most: if everything is
   * dangerous, nothing reads as dangerous.
   */
  isDanger?: boolean;
  /**
   * Greys the action out and blocks the click. Give `hint` a reason when you set
   * this — a disabled control with the enabled tooltip is a dead end.
   */
  isDisabled?: boolean;
}

export interface RowActionBarProps {
  actions: RowAction[];
  /**
   * Accessible name for the group, e.g. `Actions for “Tax return 2024”`.
   * The bar is a `<span role="group">`, so without this a screen reader announces
   * four unrelated buttons with no sense of what they share.
   */
  label: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * The actions for one row, floated over it.
 *
 * **The caller owns the hover.** This renders the bar; the element that should
 * react to the pointer is the caller's, because only the caller knows how far the
 * hover target extends — a table cell, a card, a whole row. Put `group` and
 * `relative` on that element and the bar positions itself against it:
 *
 * ```tsx
 * <span className="group relative flex ...">
 *   {title}
 *   <RowActionBar label={`Actions for “${row.title}”`} actions={…} />
 * </span>
 * ```
 *
 * **Touch gets it permanently.** `hover:` is dead weight on a phone (`design.md`
 * says so outright) and a hover-only control there is simply unreachable, so
 * `.row-action-bar` is always visible under `@media (hover: none)` — the rule
 * is on the *input*, not the width, because a touch laptop at 1400px needs it too.
 * That is also why the reveal is opacity rather than `hidden`: a `display:none`
 * bar cannot be focused, so the keyboard would never reach it either.
 */
export function RowActionBar({ actions, label, className = "" }: RowActionBarProps) {
  return (
    <span
      role="group"
      aria-label={label}
      // `pointer-events-none` while hidden, restored with the reveal: an invisible
      // bar sitting over the row would otherwise still swallow clicks meant for
      // the title under it.
      className={`row-action-bar pointer-events-none absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md border border-line bg-paper-raised p-0.5 opacity-0 shadow-sm transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none ${className}`}
    >
      {actions.map((action) => {
        const tone = action.isDanger
          ? "text-red-400 hover:bg-red-400/10 focus-visible:ring-red-500"
          : "text-brass-dark hover:bg-brass-soft focus-visible:ring-brass";
        // Matches the row-action buttons already in the app (templates, albums,
        // the journal): `p-1` around a `h-4 w-4` glyph, rounded, tinted on hover.
        const classes = `rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 ${tone}`;

        if (action.href && !action.isDisabled) {
          return (
            // A real anchor, not a button: a download and a navigation should both
            // survive middle-click, ⌘-click and "save link as".
            <a
              key={action.key}
              href={action.href}
              title={action.hint}
              aria-label={action.hint}
              className={classes}
            >
              {action.icon}
            </a>
          );
        }

        return (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.isDisabled}
            title={action.hint}
            aria-label={action.hint}
            className={`${classes} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            {action.icon}
          </button>
        );
      })}
    </span>
  );
}
