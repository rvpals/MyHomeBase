"use client";

// The two-part layout a module section shell uses: its TreeNav, and the section
// body beside or below it.
//
// This exists because the orientation depends on client state the shell can't
// see. `TreeNav` is a bar in `full` and a column in `rail`/`strip`, and a
// full-width bar left as a flex *row* item gets squashed against the content
// next to it — so the row/column decision follows the nav's state. The section
// shells (`ExpenseSection`, `StockSection`) are *server* components that read
// `deps` directly, so they can't hold that state themselves; they hand their
// already-loaded body down as `children` and name the nav they want.
//
// `nav` is a slug rather than the component, because a server parent can't pass
// a client component a render prop — the callback wouldn't survive the
// boundary. Both navs are imported here and picked by name instead.

import { useCallback, useState, type ReactNode } from "react";
import type { TreeNavState } from "@/components/tree-nav";
import { useIsCompact } from "@/components/viewport-context";
import { ExpenseNav } from "./expense-nav";
import { StockNav } from "./stock-nav";

export function SectionLayout({
  nav,
  children,
}: {
  nav: "expense" | "stock";
  children: ReactNode;
}) {
  // `useIsCompact` rather than `max-lg:` because the layout can be pinned — a
  // 1400px window can legitimately be in compact, and a media query would
  // still lay it out side by side.
  const isCompact = useIsCompact();
  // `useCallback` because TreeNav raises this from an effect keyed on the
  // callback — a fresh function each render would loop.
  const [navState, setNavState] = useState<TreeNavState>("full");
  const handleNavStateChange = useCallback((state: TreeNavState) => setNavState(state), []);
  const isNavStacked = isCompact || navState === "full";

  return (
    <div className={`flex gap-6 ${isNavStacked ? "flex-col" : "flex-row items-start"}`}>
      {/* No width here — a collapsible TreeNav owns its own (w-16 rail / w-3
          strip, and the bar sizes itself), and a fixed width on the wrapper
          would stop it shrinking. `tree-nav-sticky` is what pins the compact
          bar under the app bar; it has to sit on this wrapper rather than
          inside TreeNav, because a sticky element only travels within its
          parent's box. */}
      <div className={`tree-nav-sticky ${isNavStacked ? "" : "sticky top-6 shrink-0"}`}>
        {nav === "expense" ? (
          <ExpenseNav onStateChange={handleNavStateChange} />
        ) : (
          <StockNav onStateChange={handleNavStateChange} />
        )}
      </div>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
