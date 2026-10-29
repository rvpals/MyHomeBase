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

/**
 * Escapes a clip's title for the `text/html` clipboard flavour and the print sheet.
 *
 * The title is stored as plain text, so it is the one thing on these two paths that
 * has never been through `sanitizeClipHtml` — dropping it into markup unescaped
 * would turn a title containing `<` into broken output at best.
 *
 * Local rather than `@/lib/journal-reports`' identical helper: reaching into
 * another domain module for one string escape is the cross-module coupling
 * `ARCHITECTURE.md` warns about, and this is four lines.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The clip's body as plain text, for the clipboard's text/plain flavour.
 *
 * Deliberately NOT `clipHtmlToText` from the library: that one collapses *all*
 * whitespace to single spaces, which is right for printing a clip on one line in
 * a terminal and wrong for a paste. Here the block-level closing tags become
 * newlines, so a pasted list stays a list of lines in a plain-text box.
 *
 * A one-off (`ARCHITECTURE.md` → *One-offs*): it is view-local formatting for one
 * clipboard write, not domain logic. If a second caller ever wants it, that is the
 * moment to promote it into `sanitize-html.ts` beside its sibling.
 */
function clipHtmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse runs of blank lines, but keep single ones: the tag soup above
    // emits a newline per closing tag and nested blocks produce several.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  /** Drives the Copy button's confirmation tick. Resets itself — see below. */
  const [copied, setCopied] = useState(false);

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

  // The tick resets itself. A `setTimeout` in an effect keyed on `copied`, so the
  // timer is cleaned up on unmount and a second copy restarts it rather than
  // stacking — the same shape `floating-scratchpad.tsx` uses.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  /**
   * Whether there is plaintext on screen to copy or print.
   *
   * An open clip, or a sealed one the reader has unlocked. Drives both footer
   * buttons and the print sheet below.
   */
  const readable = !loading && (!isEncrypted || unlocked);

  /**
   * "Save to PDF" via the browser's own print dialog, whose destination list
   * includes Save as PDF on every platform this app runs on.
   *
   * No PDF library. `jspdf`/`html2pdf` would be a dependency carried app-wide to
   * re-implement, worse, what the browser already does with the real layout
   * engine — and a clip's body is arbitrary pasted markup with tables, which is
   * precisely what a hand-rolled PDF writer renders badly. The app already prints
   * this way in five other places (the attendance report, exam sheets, journal
   * reports), so this is the established path, not a new one.
   *
   * `window.print()` is synchronous and blocking, so the sheet it reads must
   * already be mounted — it is, below, as `hidden print:block`.
   */
  function handleSaveToPdf() {
    window.print();
  }

  /**
   * Copies the clip in two flavours at once: `text/html` so a paste into Outlook,
   * Word or another rich editor keeps the headings, lists and tables, and
   * `text/plain` so a paste into a terminal or a plain box gets clean text.
   *
   * `ClipboardItem` rather than `writeText`, which can only carry the plain
   * flavour — and the structure is usually the reason the clip was saved. The
   * title leads both flavours, so a pasted clip says what it is.
   *
   * Images do NOT travel. They live at `/api/clips/images/<id>` behind this app's
   * session, so the `<img>` tags are copied as-is: a paste into another app shows
   * a broken image unless that app is a browser tab already logged in here.
   * Inlining them as base64 would be the one way around it, and that is exactly
   * what migration 0079 removed for being ruinous at size.
   */
  async function handleCopy() {
    const heading = title ? `<h2>${escapeHtml(title)}</h2>` : "";
    const html = `${heading}${contentHtml}`;
    const plain = [title, clipHtmlToPlainText(contentHtml)].filter(Boolean).join("\n\n");

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setCopied(true);
    } catch {
      // Two ways here: a denied clipboard permission, or a browser without
      // `ClipboardItem`. Fall back to the plain flavour, which `writeText` has
      // supported everywhere for years, rather than telling the reader no.
      try {
        await navigator.clipboard.writeText(plain);
        setCopied(true);
      } catch {
        // The body is on screen and selectable, which is the fallback either way —
        // not worth a dialog. Same call as the scratchpad's copy.
        setError("Could not reach the clipboard. Select the text and copy it instead.");
      }
    }
  }

  return (
    <>
      {/* `Modal size="window"` rather than the hand-rolled `fixed inset-0` overlay
          this used to be. That overlay was a parallel implementation of a solved
          problem: the shared Modal already carries Escape, the focus trap, the
          scroll lock, the maximize button and — the reason for the swap — a header
          drag on every non-`full` size above 1024px, so the viewer is now movable
          without a line of pointer handling here.

          `window` sizes to its content (capped at 56rem / 85vh) instead of the
          fixed `max-w-3xl` box it had. A two-line clip no longer opens as an acre
          of empty panel, and a pasted email can still grow to the cap and then
          scroll. Below 1024px Modal forks to a full-screen sheet on its own, which
          is the behaviour the old `max-lg:` classes were hand-writing. */}
      <Modal
        title={loading ? "Loading…" : title || "(untitled)"}
        onClose={onClose}
        size="window"
        footer={
          <>
            {/* Both are hidden while the clip is sealed: there is nothing to copy or
                print until a password has produced plaintext, and offering the
                buttons would promise something they cannot do. */}
            {readable && (
              <>
                <Button variant="secondary" onClick={handleSaveToPdf}>
                  Save to PDF
                </Button>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy to clipboard"}
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
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

      {/* The printed sheet — a SIBLING of the Modal, deliberately, not a child.

          The Modal renders a `fixed inset-0` wrapper in place (no portal), and a
          `fixed` element prints as whatever fits one viewport-sized box: a long
          clip inside it would come out truncated at the first page. A static block
          in the normal flow paginates properly, so a pasted email runs to as many
          pages as it needs. `exam-home-view.tsx` places its answer sheets outside
          its Modal for exactly this reason.

          `hidden print:block` keeps it off the screen while still printing —
          `window.print()` reads the layout, not the viewport. `.print-sheet` is
          what the `@media print` block in `globals.css` reveals: it hides
          `body *`, un-hides this subtree, and forces black on white.
          `.clip-content` restores the heading sizes, list markers and table
          borders that the sanitizer's removal of inline `style` takes away.

          Mounted only when `readable`, so printing a sealed clip yields nothing
          rather than an empty sheet with a heading. */}
      {readable && (
        <div className="print-sheet hidden print:block">
          {title && <h1 className="mb-3 text-xl font-semibold">{title}</h1>}
          {/* `dangerouslySetInnerHTML` on markup that has already been through
              `sanitizeClipHtml` on the way in — the same stored string
              `RichTextEditor` renders above. Re-sanitizing in the browser would be
              a second, subtly different pass over content the library already made
              safe, and the two disagreeing is how a renderer drifts. */}
          <div
            className="clip-content text-sm"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>
      )}
    </>
  );
}
