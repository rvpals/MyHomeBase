// Password prompt for an encrypted journal entry — the unlock form, the encrypt
// form, and the confirm-before-decrypting form, which are the same three fields
// in different combinations.
//
// Pure presentation: it collects a password and raises it. It never decrypts,
// never calls an action, and never holds the password after the submit — the
// screen above owns that, because it is also what decides how long an unlock
// lasts (`entry-screen.tsx` drops it on navigation).
//
// Renders **inline or as a dialog**, same fields and same validation either way
// (`asModal`). The two presentations share one component rather than being two
// call sites of a field set, because the rule that matters here — that a
// mistyped password is caught before the submit — must not be able to drift
// between them.
//
// **The password fields declare `autocomplete="new-password"`, not `"off"`.**
// That looks backwards and isn't: Chrome and Safari deliberately *ignore* `off`
// on password inputs — it was abused widely enough that they stopped honouring
// it — so `off` still raises the "Save password?" bubble. `new-password` is the
// value they do respect, and it suppresses both the save prompt and autofill.
// Offering to save this password would be actively misleading: nothing in this
// app stores it, and a reader who trusts the browser to remember it has quietly
// moved their only copy into something this app can neither see nor restore.
// The `data-1p-ignore` / `data-lpignore` / `data-bwignore` attributes do the
// same job for 1Password, LastPass and Bitwarden, which ignore the standard
// attribute entirely.
//
// **That attribute alone was not enough**, and the two things beside it are not
// belt-and-braces — each closes a trigger the attribute doesn't:
//
//   1. **The fields are blanked in the DOM before `onSubmit` is raised.** Chrome
//      fires the bubble on the *navigation after* a submit and reads the input's
//      live value then. Callers unmount this prompt and call `router.refresh()`
//      in one React batch, so a React-only clear lands too late. This is what
//      the New Entry and single-entry screens were hitting while the bulk
//      encrypt — which doesn't navigate the same way — looked fine.
//   2. **A decoy `autocomplete="username"` input.** A lone password field reads
//      as a credential form; an empty username beside it does not.
//
// See components.md before adding another password field to this module.

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import {
  ENTRY_ENCRYPTION_EXPLAINER_TITLE,
  EntryEncryptionExplainer,
} from "./entry-encryption-explainer";
import { Modal } from "./modal";

/** Which of the three jobs the prompt is doing. */
type Mode = "unlock" | "encrypt" | "confirm";

export interface EncryptionPromptProps {
  /**
   * `unlock` — one password field, plus the hint if there is one.
   * `encrypt` — password twice and an optional hint, with the warning.
   * `confirm` — one password field, for removing encryption.
   */
  mode: Mode;
  /**
   * Render as a dialog instead of an inline card.
   *
   * The encrypt and remove-encryption prompts use this: both are deliberate,
   * interrupting decisions with a consequence that can't be undone, and a dialog
   * is what stops the rest of the entry competing for attention. The *unlock*
   * prompt stays inline — it is where the entry's body would be, so it reads as
   * the entry being shut rather than as the app asking a question.
   */
  asModal?: boolean;
  /**
   * The entry's stored hint. Shown above the field in `unlock`. Blank means the
   * entry has none, and nothing is rendered.
   */
  hint?: string;
  /** Shown in place of the built-in message — a failed unlock, usually. */
  error?: string;
  /** Disables the form while the action is in flight. */
  isBusy?: boolean;
  /**
   * Raised with the typed password, and (in `encrypt`) the typed hint. The
   * parent clears or keeps the prompt depending on whether it succeeded.
   */
  onSubmit: (password: string, hint: string) => void;
  /**
   * Dismisses the prompt. Omit to render without a cancel button — which is what
   * the inline unlock prompt does, since there is nothing to go back to.
   *
   * **Required in practice when `asModal` is set**: a dialog must be closable, so
   * `Modal`'s Escape, overlay click and ✕ all need somewhere to go.
   */
  onCancel?: () => void;
  /**
   * Overrides the heading and the confirm button's label.
   *
   * The New Entry screen's "Save entry encrypted" uses it: there the dialog is
   * finishing a *save*, so "Encrypt this entry" would describe the wrong action
   * and imply an entry that already exists. The warning text and the
   * confirm-password rule are unchanged -- only the two labels move.
   */
  heading?: string;
  actionLabel?: string;
  /**
   * How many entries this will seal, when the prompt is finishing a **bulk**
   * encrypt rather than acting on one entry.
   *
   * Rendered above the warning, because in a batch the count is the number the
   * reader most needs to check: the password is recoverable from nowhere, so a
   * selection that is larger than they think is the expensive mistake. Omit it
   * for the single-entry prompts, which say which entry they mean by being on
   * its screen.
   *
   * Only the count is taken, not the rows — this component has no business
   * knowing what a `JournalEntry` is.
   */
  count?: number;
  /** Caller-supplied classes, merged last so they win. Inline only. */
  className?: string;
}

const inputClasses =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const COPY: Record<Mode, { heading: string; action: string; passwordLabel: string }> = {
  unlock: {
    heading: "This entry is encrypted",
    action: "Unlock",
    passwordLabel: "Password",
  },
  encrypt: {
    heading: "Encrypt this entry",
    action: "Encrypt",
    passwordLabel: "Password",
  },
  confirm: {
    heading: "Remove encryption",
    action: "Remove encryption",
    passwordLabel: "Password",
  },
};

export function EncryptionPrompt({
  mode,
  asModal = false,
  hint = "",
  error,
  isBusy = false,
  onSubmit,
  onCancel,
  heading,
  actionLabel,
  count,
  className = "",
}: EncryptionPromptProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hintDraft, setHintDraft] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // The prompt is the only thing on screen worth typing into when it appears,
  // and an unlock is nearly always the reader's next keystroke. In a dialog this
  // runs after `Modal` has moved focus to the panel, so it lands on the field
  // rather than fighting the focus trap.
  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const base = COPY[mode];
  const copy = {
    ...base,
    heading: heading ?? base.heading,
    action: actionLabel ?? base.action,
  };
  const isEncrypting = mode === "encrypt";

  /**
   * Validates and raises. Returns nothing — the caller decides what happens
   * next, including whether the prompt stays on screen.
   */
  function submit() {
    setLocalError(undefined);

    if (password === "") {
      setLocalError("Enter the password.");
      return;
    }
    if (isEncrypting && password !== confirmPassword) {
      // Caught here rather than server-side: a mistyped password on the way in
      // seals the entry under something the reader does not know, and there is
      // no way to recover from that afterwards.
      setLocalError("The two passwords do not match.");
      return;
    }

    // Blank the actual DOM nodes **before** raising, not just the React state.
    //
    // Chrome fires the "Save password?" bubble on the navigation that follows a
    // submit, and it reads the input's live value at that moment. Every caller
    // here unmounts this prompt and calls `router.refresh()` in the same React
    // batch, so clearing only the state below leaves the node holding the typed
    // password when the navigation lands — which is the bubble's exact trigger,
    // and why `autocomplete="new-password"` alone didn't stop it on the New
    // Entry and single-entry screens.
    //
    // Writing `.value` directly is deliberate: React's own update is async and
    // lands too late, where this is synchronous and happens before `onSubmit`
    // starts anything. The state resets immediately after, so the two agree.
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmRef.current) confirmRef.current.value = "";

    onSubmit(password, hintDraft.trim());
    setPassword("");
    setConfirmPassword("");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit();
  }

  const shownError = error ?? localError;

  // The fields, shared by both presentations. `onSubmit` on the form is what
  // makes Enter work in either one — in the dialog the footer button is outside
  // the form element, so it submits by calling `submit()` directly.
  const fields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* A decoy username, never shown and never read.
          Chrome treats a lone password field as a credential form and offers to
          save it against the page's origin. Giving it a username input it can
          see, which is empty and `aria-hidden`, is the long-standing counter —
          the heuristic wants a pair, and an empty one it can't fill is not
          worth a prompt. `hidden`/`display:none` fields are skipped by the
          heuristic entirely, so this has to be technically rendered. `sr-only`
          keeps it in the layout tree at zero visible size without `absolute`,
          which inside this grid would have anchored to the page rather than to
          the card. `aria-hidden` + `tabIndex={-1}` keep it out of the a11y tree
          and the tab order, so nothing but the heuristic ever sees it. */}
      <input
        type="text"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="username"
        value=""
        readOnly
        className="sr-only"
      />

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">{copy.passwordLabel}</span>
        <input
          ref={passwordRef}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isBusy}
          // `new-password`, not `off` — see the note below the component.
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          className={inputClasses}
        />
      </label>

      {isEncrypting && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Confirm password</span>
          <input
            ref={confirmRef}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isBusy}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className={inputClasses}
          />
        </label>
      )}

      {isEncrypting && (
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Hint (optional)</span>
          <input
            type="text"
            value={hintDraft}
            onChange={(event) => setHintDraft(event.target.value)}
            disabled={isBusy}
            // Not a password field, but it sits in the same form and a browser
            // heuristic will happily offer it as a "username" to pair with the
            // password above — which would file the hint in a password manager
            // next to a password this app never stores.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className={inputClasses}
          />
          <span className="mt-1 block text-xs text-muted">
            Stored unencrypted and shown to anyone who opens this entry — so it must not
            contain the password itself.
          </span>
        </label>
      )}

      {shownError && <p className="text-sm text-red-400 sm:col-span-2">{shownError}</p>}
    </div>
  );

  // The explanatory text above the fields, in whichever form this mode needs.
  const preamble = (
    <>
      {mode === "unlock" && hint.trim() !== "" && (
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">Hint:</span> {hint}
        </p>
      )}

      {mode === "confirm" && hint.trim() !== "" && (
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">Hint:</span> {hint}
        </p>
      )}

      {isEncrypting && count !== undefined && (
        <p className="text-sm text-ink">
          <span className="font-medium">
            {count} {count === 1 ? "entry" : "entries"}
          </span>{" "}
          will be sealed under one password.
        </p>
      )}

      {isEncrypting && (
        <p className="text-sm text-muted">
          The title and body are sealed with this password. Everything else — the date,
          place, categories, tags and any photos — stays readable.{" "}
          <span className="font-medium text-ink">
            If you forget this password the entry cannot be recovered by anyone, including
            an administrator.
          </span>
        </p>
      )}

      {/* Collapsed by default: the sentence above is what someone needs to
          decide, and this is the detail they may want before trusting it with
          something they care about. A `<details>` rather than `Comments` --
          that one opens its own Modal, and this already *is* one. The prose is
          the same either way; it lives in one file so the two cannot drift. */}
      {isEncrypting && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
            {ENTRY_ENCRYPTION_EXPLAINER_TITLE}
          </summary>
          <div className="flex flex-col gap-3 border-t border-line bg-paper px-3 py-3 text-xs leading-relaxed text-muted">
            <EntryEncryptionExplainer />
          </div>
        </details>
      )}
    </>
  );

  if (asModal) {
    return (
      <Modal
        title={copy.heading}
        size="md"
        // Suppresses Escape, the overlay click and the ✕ while the write is in
        // flight, so a half-finished encrypt can't be orphaned by a stray click.
        isBusy={isBusy}
        onClose={() => onCancel?.()}
        footer={
          <>
            <Button variant="secondary" onClick={() => onCancel?.()} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isBusy}>
              {isBusy ? "Working…" : copy.action}
            </Button>
          </>
        }
      >
        {/* Still a form, so Enter submits from either field. */}
        <form onSubmit={handleSubmit} autoComplete="off" data-form-type="other" className="flex flex-col gap-4">
          {preamble}
          {fields}
          {/* The visible buttons live in the footer; this one exists only so a
              browser treats Enter in a single-field form as a submit. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      data-form-type="other"
      className={`flex flex-col gap-4 rounded-xl border border-line bg-paper-raised p-5 max-lg:p-4 ${className}`}
    >
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">{copy.heading}</h2>
        {preamble}
      </div>

      {fields}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isBusy}>
          {isBusy ? "Working…" : copy.action}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
