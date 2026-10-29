// The note behind the "Select" toggle's `Comments` mark, shared by both grid layouts.
//
// Its own module rather than an export from `data-grid`, because `data-grid` and
// `data-grid-compact` already import each other and that cycle is types-only today —
// TypeScript erases a `import type`, so nothing circular survives to runtime. Pulling a
// *value* across it would make the cycle real for the sake of one paragraph of copy.
// A leaf module both sides import is the cheaper answer.

import type { ReactNode } from "react";

/**
 * Written for someone using the grid, not someone maintaining it: what a click does
 * while the mode is on, what happens to the ticks when it goes off, and the one
 * surprise (a row that normally opens stops opening until you switch it back).
 */
export function SelectModeHelp(): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <p>
        Turns the whole row into a checkbox. While <span className="text-ink">Select</span>{" "}
        is on, clicking <span className="text-ink">anywhere on a row</span> ticks it — no
        need to aim for the small box at the left edge each time.
      </p>
      <p>
        Buttons and links inside a row still do their own job. Edit, delete and anything
        else in the row keeps working as usual.
      </p>
      <p>
        Click <span className="text-ink">Select</span> again to turn it off. Your ticks
        stay — collect the rows you want, switch it off, and carry on reading the table
        with them still selected.
      </p>
      <p>
        On some screens a row click normally opens that record. While Select is on it
        selects instead; turning it off gives you the record back.
      </p>
    </div>
  );
}
