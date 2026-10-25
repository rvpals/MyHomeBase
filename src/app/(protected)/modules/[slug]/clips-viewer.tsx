"use client";

// Reads one clip. Prompts for a password when the clip is sealed, and renders the
// stored markup once it has plaintext to show.
//
// This is also what the Journal's badge opens — a reader clicking the paperclip on
// an entry lands here, which is why the viewer takes a clip id and nothing else.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { RichTextEditor } from "@/components/rich-text-editor";
import { getClipAction, openClipAction } from "./clips-actions";
import { ClipsLinkPanel } from "./clips-link-panel";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ClipsViewer({ clipId, onClose }: { clipId: number; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [passwordHint, setPasswordHint] = useState("");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void getClipAction(clipId).then((result) => {
      if (cancelled) return;
      setLoading(false);

      if (!result.ok || !result.clip) {
        setError(result.error ?? "Could not load that clip.");
        return;
      }

      setIsEncrypted(result.clip.isEncrypted);
      setPasswordHint(result.clip.passwordHint);
      // A sealed clip's title and body come back blank — the ciphertext is not
      // rendered, and there is nothing to show until a password opens it.
      setTitle(result.clip.title);
      setContentHtml(result.clip.contentHtml);
    });

    return () => {
      cancelled = true;
    };
  }, [clipId]);

  async function handleUnlock() {
    setError("");
    const result = await openClipAction(clipId, password);

    if (!result.ok) {
      // One message for a wrong password and for altered bytes: GCM cannot tell
      // them apart, and the library deliberately does not invent a distinction.
      setError(result.error ?? "That password does not open this clip.");
      return;
    }

    setTitle(result.title ?? "");
    setContentHtml(result.contentHtml ?? "");
    setUnlocked(true);
    // Not kept after it has been used — nothing here needs it again, and holding it
    // in state only widens where it can leak from.
    setPassword("");
  }

  return (
    // `Modal size="window"` rather than the hand-rolled `fixed inset-0` overlay this
    // used to be. That overlay was a parallel implementation of a solved problem:
    // the shared Modal already carries Escape, the focus trap, the scroll lock, the
    // maximize button and — the reason for the swap — a header drag on every
    // non-`full` size above 1024px, so the viewer is now movable without a line of
    // pointer handling here.
    //
    // `window` sizes to its content (capped at 56rem / 85vh) instead of the fixed
    // `max-w-3xl` box it had. A two-line clip no longer opens as an acre of empty
    // panel, and a pasted email can still grow to the cap and then scroll. Below
    // 1024px Modal forks to a full-screen sheet on its own, which is the behaviour
    // the old `max-lg:` classes were hand-writing.
    <Modal
      title={loading ? "Loading…" : title || "(untitled)"}
      onClose={onClose}
      size="window"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        {error && <p className="text-sm text-danger">{error}</p>}

        {isEncrypted && !unlocked ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              This clip is encrypted. Enter its password to read it.
            </p>
            {passwordHint && (
              <p className="text-sm text-muted">
                Hint: <span className="text-ink">{passwordHint}</span>
              </p>
            )}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleUnlock();
              }}
              placeholder="Password"
              className={INPUT_CLASS}
            />
            <Button variant="primary" onClick={handleUnlock}>
              Open
            </Button>
          </div>
        ) : (
          <>
            {/* Read-only: the same component that writes a clip renders it, so the
                markup is displayed exactly as the editor would show it rather than
                through a second, subtly different renderer. */}
            <RichTextEditor value={contentHtml} onChange={() => {}} readOnly />
            {/* Below the body, and only once the clip is readable. A sealed clip
                hides its attachments too: which entries someone's private note
                supports is itself worth not leaking before the password. */}
            {!loading && <ClipsLinkPanel clipId={clipId} />}
          </>
        )}
      </div>
    </Modal>
  );
}
