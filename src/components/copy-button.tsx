"use client";

// Copies a string to the clipboard and says so.
//
// Promoted from the Code Library's snippet card, where "give me this, exactly as
// stored" is the module's whole point. Five places in the app had already
// hand-rolled this (the clip viewer, the scratchpad, the AI-export view, the
// ticker consult dialog and the Admin code tester), each with its own timer and
// its own idea of what a failure looks like. This is the shared one — see
// `components.md` before writing a sixth.
//
// Pure presentation: it takes the text and copies it. It never fetches, so the
// caller must already hold what is being copied. That is deliberate and it is the
// reason this works everywhere: the clipboard write happens inside the click, with
// nothing awaited first. An `await` before the write can spend the browser's
// user-gesture window, which is how a copy button comes to fail on Safari and
// nowhere else.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";

type Size = "sm" | "md";
type Variant = "primary" | "secondary";

export interface CopyButtonProps {
  /** Exactly what lands on the clipboard. Copied byte for byte, never trimmed. */
  text: string;
  /** The resting label. Defaults to "Copy". */
  label?: string;
  /**
   * Native tooltip, and the accessible name when the label alone is ambiguous.
   *
   * Worth setting wherever the button sits beside a *truncated* view of the text:
   * "Copy all 42 lines" tells a reader they get the whole thing, which "Copy" next
   * to six visible lines does not.
   */
  title?: string;
  size?: Size;
  variant?: Variant;
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** How long the confirmation shows. Matches the scratchpad's note copy. */
const FEEDBACK_MS = 1500;

export function CopyButton({
  text,
  label = "Copy",
  title,
  size = "sm",
  variant = "secondary",
  disabled = false,
  className = "",
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = useCallback(() => {
    // Not awaited: the write is started inside the click and the result is
    // handled when it lands. Awaiting here would be the same thing, but writing
    // it as a promise chain keeps it obvious that nothing precedes the write.
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      // A denied permission, an insecure origin, or a browser without the API.
      // Not worth a dialog — the text is on screen and selectable, which is the
      // fallback either way — but silence reads as a broken button, so the label
      // says so for a moment.
      () => setState("failed"),
    );
  }, [text]);

  // The label resets itself. A `setTimeout` in an effect keyed on the state, so
  // the timer is cleaned up on unmount and a second copy restarts it rather than
  // stacking two.
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleCopy}
      disabled={disabled}
      title={title}
      className={className}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
