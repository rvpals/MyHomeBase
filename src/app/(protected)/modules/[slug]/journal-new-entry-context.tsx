"use client";

// Shares the home screen's "is the New Journal card showing?" state between the
// title row's New Entry button and the card itself.
//
// A context rather than a prop because the two live on opposite sides of a
// server boundary: `JournalSection` is a server component that renders the
// already-loaded `SectionBody` into `JournalHomeHeader` as `children`. A parent
// can't clone a prop into server-rendered children, so the header provides the
// state and `JournalView` reads it.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface JournalNewEntryState {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

// Defaults to closed with a no-op setter, so a `JournalView` rendered outside
// the provider (any section other than the home screen) still works — it just
// never shows the card.
const JournalNewEntryContext = createContext<JournalNewEntryState>({
  isOpen: false,
  setIsOpen: () => {},
});

export function JournalNewEntryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo(() => ({ isOpen, setIsOpen }), [isOpen]);
  return (
    <JournalNewEntryContext.Provider value={value}>{children}</JournalNewEntryContext.Provider>
  );
}

export function useJournalNewEntry(): JournalNewEntryState {
  return useContext(JournalNewEntryContext);
}
