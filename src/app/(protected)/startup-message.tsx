"use client";

// One-off home-screen dialog (not a registered shared component) — it reuses the
// registered `Modal` and `Button` and adds nothing but the dismiss wiring.
//
// The server only renders this when there is a message, so it opens immediately.
// Dismissing clears the app-wide setting, which is what makes it show once.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { dismissStartupMessageAction } from "./startup-message-actions";

export function StartupMessage({ message }: { message: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isDismissing, setIsDismissing] = useState(false);

  async function handleDismiss() {
    setIsDismissing(true);
    // Closes either way: if the clear fails the message reappears on the next
    // visit, which is a far better outcome than a dialog that won't go away.
    try {
      await dismissStartupMessageAction();
    } finally {
      setIsDismissing(false);
      setIsOpen(false);
    }
  }

  if (!isOpen) return null;

  return (
    <Modal
      title="Deployment notice"
      onClose={handleDismiss}
      size="sm"
      isBusy={isDismissing}
      footer={
        <Button onClick={handleDismiss} disabled={isDismissing}>
          OK
        </Button>
      }
    >
      <p className="text-sm leading-relaxed text-ink">{message}</p>
    </Modal>
  );
}
