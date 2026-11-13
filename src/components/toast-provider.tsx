"use client";

// The one place transient feedback is mounted. Sonner renders the toasts; this
// wrapper only styles them with theme tokens (never literal colours) and keeps
// them clear of the bottom chrome. Mounted once in the root layout so /login
// gets it too. Fire toasts through `@/components/toast-notify`, not from here.

import { Toaster } from "sonner";

const BOTTOM =
  "calc(var(--section-trigger-height, 0px) + var(--music-player-height, 0px) + env(safe-area-inset-bottom) + 12px)";

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      // Success 3s; errors are overridden to 5s in toast-notify.ts.
      duration={3000}
      // Both vars are 0px when nothing occupies the bottom edge, so this is just
      // a 12px gutter on desktop with no player and lifts above the section bar
      // and music player otherwise. `mobileOffset` covers Sonner's own <600px mode.
      offset={{ bottom: BOTTOM, right: 16 }}
      mobileOffset={{ bottom: BOTTOM, left: 16, right: 16 }}
      toastOptions={{
        style: {
          background: "var(--paper-raised)",
          color: "var(--ink)",
          border: "var(--line-width, 1px) solid var(--line)",
          borderRadius: "0.75rem",
          fontFamily: "inherit",
        },
      }}
    />
  );
}
