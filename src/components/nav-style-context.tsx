"use client";

// Supplies the reader's compact navigation style to the shell.
//
// Same shape as `ViewportProvider` and `IconSetProvider`, and for the same
// reason: the value is decided on the server — here from the reader's stored
// preference rather than a cookie — and handed down, so the first HTML already
// draws the bar they chose and there is no flip after hydration. Navigation is
// the worst possible place for a visible rearrangement one frame in.
//
// **Only `SectionPanel` needs this.** It affects the compact layout alone; on
// `full` both styles render the identical 240px panel, so no other component
// should branch on it.

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_COMPACT_NAV_STYLE,
  DEFAULT_DESKTOP_NAV_STYLE,
  type CompactNavStyle,
  type DesktopNavStyle,
} from "@/lib/user-preferences";

// Defaults to the same style a user with no stored preference resolves to, so a
// component rendered outside a provider — a test, a harness — matches the app.
const CompactNavStyleContext = createContext<CompactNavStyle>(DEFAULT_COMPACT_NAV_STYLE);

export function CompactNavStyleProvider({
  value,
  children,
}: {
  value: CompactNavStyle;
  children: ReactNode;
}) {
  return (
    <CompactNavStyleContext.Provider value={value}>{children}</CompactNavStyleContext.Provider>
  );
}

/** The reader's compact navigation style. Meaningful on compact only. */
export function useCompactNavStyle(): CompactNavStyle {
  return useContext(CompactNavStyleContext);
}

// The full layout's counterpart. Separate context rather than one object, so a
// component that reads only one of the two doesn't re-render when the other
// changes — and so the pairing with the layout it affects stays obvious.
//
// **Only `TwoTierShell` needs this.** It affects the full layout alone; on
// compact both shapes render the identical bottom bar, so no other component
// should branch on it.
const DesktopNavStyleContext = createContext<DesktopNavStyle>(DEFAULT_DESKTOP_NAV_STYLE);

export function DesktopNavStyleProvider({
  value,
  children,
}: {
  value: DesktopNavStyle;
  children: ReactNode;
}) {
  return (
    <DesktopNavStyleContext.Provider value={value}>{children}</DesktopNavStyleContext.Provider>
  );
}

/** The reader's full-layout navigation shape. Meaningful on the full layout only. */
export function useDesktopNavStyle(): DesktopNavStyle {
  return useContext(DesktopNavStyleContext);
}
