"use client";

// The snippet editor, and the two buttons that open it.
//
// A client island on an otherwise server-rendered screen: the list in
// `code-library-home-view.tsx` stays a server component and ships no JavaScript,
// and only this file's dialog does. That is the split item 1's comment promised
// for when the first interactive control arrived.
//
// The form is a plain <textarea>, not `RichTextEditor`. A contentEditable would
// reintroduce exactly the problems this module exists to avoid — collapsed
// indentation and markup in the body — and a textarea preserves tabs, newlines
// and leading spaces for free.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { CopyButton } from "@/components/copy-button";
import { TintPicker } from "@/components/tint-picker";
import {
  SNIPPET_LANGUAGES,
  SNIPPET_LANGUAGE_LABELS,
  SNIPPET_TITLE_MAX_LENGTH,
  type SnippetCardColor,
  type SnippetLanguage,
} from "@/lib/code-library";
import {
  createSnippetAction,
  decryptSnippetAction,
  encryptSnippetAction,
  getSnippetAction,
  openSnippetAction,
  recycleSnippetAction,
  setSnippetColorAction,
  setSnippetPinnedAction,
  updateSnippetAction,
} from "./code-library-actions";

/** A comma-separated box to a list, and back. The schema drops blanks and repeats. */
function splitLabels(value: string): string[] {
  return value.split(",");
}

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * What the dialog is editing: a new snippet, or an existing one **by id alone**.
 *
 * Deliberately not the snippet's fields. The list is a projection carrying only
 * the opening lines of each body (`SnippetSummary`), so a card genuinely does not
 * have the full code to hand down — it is fetched below when the dialog opens.
 * Passing a truncated preview into an editor would save the truncation over the
 * real snippet, which is the worst bug this module could have.
 */
type EditorTarget = { mode: "create" } | { mode: "edit"; id: number };

function SnippetEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<SnippetLanguage>("text");
  // Held as the raw text of the box, not as arrays: a reader mid-way through
  // typing "sql, post" has a trailing fragment that is not yet a label, and
  // parsing on every keystroke would fight them. Split once, on save.
  const [categoriesText, setCategoriesText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  // Editing starts loading; creating has nothing to fetch and starts ready.
  const [isLoading, setIsLoading] = useState(target.mode === "edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const editingId = target.mode === "edit" ? target.id : 0;

  useEffect(() => {
    if (editingId === 0) return;

    // `cancelled` rather than an AbortController: a server action cannot be
    // aborted, so the guard is against writing state into an unmounted dialog —
    // close it fast enough and the response still arrives.
    let cancelled = false;

    void getSnippetAction(editingId).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.snippet) {
        setError(result.error ?? "Could not load that snippet.");
        setIsLoading(false);
        return;
      }
      setTitle(result.snippet.title);
      setCode(result.snippet.code);
      setLanguage(result.snippet.language);
      setCategoriesText(result.snippet.categories.join(", "));
      setTagsText(result.snippet.tags.join(", "));
      setSourceUrl(result.snippet.sourceUrl);
      setNotes(result.snippet.notes);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [editingId]);

  async function handleSave() {
    setIsSaving(true);
    setError("");

    // `code` is passed exactly as typed — not trimmed here and not trimmed by the
    // schema. Trimming in the view would be the same bug as trimming in the
    // library, just further from the test that catches it.
    const categories = splitLabels(categoriesText);
    const tags = splitLabels(tagsText);

    const result =
      target.mode === "edit"
        ? await updateSnippetAction({
            id: target.id,
            title,
            code,
            language,
            categories,
            tags,
            sourceUrl,
            notes,
          })
        : await createSnippetAction({
            title,
            code,
            language,
            categories,
            tags,
            sourceUrl,
            notes,
          });

    setIsSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save that snippet.");
      return;
    }

    // The action revalidated the route; this re-renders the server component so
    // the row appears or updates without a full navigation.
    router.refresh();
    onClose();
  }

  return (
    <Modal
      title={target.mode === "edit" ? "Edit snippet" : "New snippet"}
      // `window` rather than `md`: a snippet wants height, and this size gives the
      // textarea room without going full-bleed. It stays draggable on a desktop
      // and the component takes itself full-screen on a phone.
      size="window"
      isBusy={isSaving}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {isLoading ? (
        // A load that failed (the snippet was deleted in another tab) leaves this
        // branch showing the reason rather than an empty form that would save a
        // blank body over nothing.
        <p className={`text-sm ${error === "" ? "text-muted" : "text-red-400"}`}>
          {error === "" ? "Loading the snippet…" : error}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Stacks below `sm` and sits side by side above it: the title wants the
              room and the language picker is narrow. */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-sm text-muted">
              Title
              <input
                type="text"
                value={title}
                maxLength={SNIPPET_TITLE_MAX_LENGTH}
                placeholder="Optional"
                onChange={(event) => setTitle(event.target.value)}
                className={`mt-1 ${INPUT_CLASS}`}
              />
            </label>

            <label className="text-sm text-muted sm:w-48">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as SnippetLanguage)}
                className={`mt-1 ${INPUT_CLASS}`}
              >
                {SNIPPET_LANGUAGES.map((key) => (
                  <option key={key} value={key}>
                    {SNIPPET_LANGUAGE_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Comma-separated boxes rather than a picker: typing a new word files
              the snippet *and* adds it to the vocabulary, which is what the
              repository's `replacePairings` does. A picker would mean visiting
              Categories & Tags before you could label anything. Existing words
              are on the home screen's chips, and the management screen is where
              they get tidied. */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-sm text-muted">
              Categories
              <input
                type="text"
                value={categoriesText}
                placeholder="Query, Config — comma separated"
                onChange={(event) => setCategoriesText(event.target.value)}
                className={`mt-1 ${INPUT_CLASS}`}
              />
            </label>

            <label className="flex-1 text-sm text-muted">
              Tags
              <input
                type="text"
                value={tagsText}
                placeholder="postgres, docker"
                onChange={(event) => setTagsText(event.target.value)}
                className={`mt-1 ${INPUT_CLASS}`}
              />
            </label>
          </div>

          <label className="block text-sm text-muted">
            Where it came from
            <input
              type="url"
              value={sourceUrl}
              placeholder="https://… (optional)"
              onChange={(event) => setSourceUrl(event.target.value)}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </label>

          <label className="block text-sm text-muted">
            Notes
            {/* Kept out of the body on purpose: the code has to stay
                copy-pasteable verbatim, and commenting an explanation into it
                would mean pasting that explanation into a terminal. */}
            <textarea
              value={notes}
              rows={2}
              placeholder="Why this approach, what it breaks, which version it needs"
              onChange={(event) => setNotes(event.target.value)}
              className={`mt-1 ${INPUT_CLASS} resize-y`}
            />
          </label>

          <label className="block text-sm text-muted">
            Code
            {/* `spellCheck` off and the autocorrect attributes cleared: a browser
                "correcting" an identifier inside the body would silently change
                the snippet, which is the one thing this module must never do.
                `wrap="off"` keeps a long line on one line, scrolling sideways in
                its own box rather than reflowing code written to a width. */}
            <textarea
              value={code}
              rows={18}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              wrap="off"
              placeholder="Paste or type the snippet…"
              onChange={(event) => setCode(event.target.value)}
              className={`mt-1 ${INPUT_CLASS} resize-y whitespace-pre font-mono text-xs`}
            />
          </label>

          {error !== "" && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/** The "New snippet" button above the list. */
export function NewSnippetButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>New snippet</Button>
      {isOpen && <SnippetEditor target={{ mode: "create" }} onClose={() => setIsOpen(false)} />}
    </>
  );
}

/**
 * The per-card pin toggle.
 *
 * Its own action rather than a field on the editor's save: pinning from the list
 * must not round-trip the whole body, and an edit saved from another tab must not
 * silently undo a pin made here.
 *
 * Refreshes rather than flipping locally, because pinning changes the snippet's
 * *position* — which band it sits in — and that is the server's answer to give. A
 * local flip would redraw the button and leave the card where it was.
 */
export function PinSnippetButton({ id, isPinned }: { id: number; isPinned: boolean }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function toggle() {
    setIsBusy(true);
    await setSnippetPinnedAction(id, !isPinned);
    setIsBusy(false);
    router.refresh();
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => void toggle()}
      disabled={isBusy}
      // `ariaPressed` because this is a two-state toggle, not an action: without
      // it a screen reader announces only the label, and a label that carries
      // the state reads as a button that performs it.
      ariaPressed={isPinned}
      title={isPinned ? "Unpin this snippet" : "Pin this snippet to the top"}
    >
      {isPinned ? "Pinned" : "Pin"}
    </Button>
  );
}

/**
 * The per-card tint picker.
 *
 * Opens on click rather than sitting open: six swatches on every card would
 * outweigh the card. Its own action, like the pin, so recolouring never
 * round-trips the body.
 */
export function ColorSnippetButton({
  id,
  color,
}: {
  id: number;
  color: SnippetCardColor | "";
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function choose(next: SnippetCardColor | "") {
    setIsBusy(true);
    await setSnippetColorAction(id, next);
    setIsBusy(false);
    setIsOpen(false);
    router.refresh();
  }

  if (!isOpen) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsOpen(true)}
        ariaExpanded={false}
        title="Change this card's colour"
      >
        Colour
      </Button>
    );
  }

  return (
    <TintPicker
      value={color}
      onChange={(next) => void choose(next)}
      ariaLabel="Card colour"
      disabled={isBusy}
    />
  );
}

/**
 * The per-card Delete button.
 *
 * Moves the snippet to the bin (migration 0183) and says so — the confirmation
 * deliberately does not claim the delete is final, because it is not. The
 * irreversible step lives in Recycled Snippets.
 */
export function DeleteSnippetButton({ id, title }: { id: number; title: string }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function remove() {
    if (
      !confirm(
        `Delete "${title || "this snippet"}"? You can restore it from Recycled Snippets.`,
      )
    ) {
      return;
    }
    setIsBusy(true);
    await recycleSnippetAction(id);
    setIsBusy(false);
    router.refresh();
  }

  return (
    <Button size="sm" variant="danger" onClick={() => void remove()} disabled={isBusy}>
      Delete
    </Button>
  );
}

/**
 * Seal a snippet, or open a sealed one.
 *
 * Both live here because they are the same affordance from the reader's side —
 * the padlock on this card — and because an open dialog needs the id either way.
 *
 * A sealed snippet's plaintext is fetched, shown and then forgotten: opening it
 * does **not** unseal it, and nothing is written. Unsealing is the separate
 * button inside the dialog.
 */
export function SealSnippetButton({
  id,
  isEncrypted,
  passwordHint,
}: {
  id: number;
  isEncrypted: boolean;
  passwordHint: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [hint, setHint] = useState("");
  const [revealed, setRevealed] = useState<{ title: string; code: string } | undefined>(
    undefined,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    // The plaintext is dropped on close rather than kept in state — a dialog
    // reopened later must ask for the password again.
    setIsOpen(false);
    setPassword("");
    setRevealed(undefined);
    setError("");
  }

  async function seal() {
    setIsBusy(true);
    setError("");
    const result = await encryptSnippetAction({ id, password, passwordHint: hint });
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not seal that snippet.");
      return;
    }
    close();
    router.refresh();
  }

  async function open() {
    setIsBusy(true);
    setError("");
    const result = await openSnippetAction({ id, password });
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not open that snippet.");
      return;
    }
    setRevealed({ title: result.title ?? "", code: result.code ?? "" });
  }

  async function unseal() {
    setIsBusy(true);
    setError("");
    const result = await decryptSnippetAction({ id, password });
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not unseal that snippet.");
      return;
    }
    close();
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsOpen(true)}
        title={isEncrypted ? "Open this sealed snippet" : "Seal this snippet behind a password"}
      >
        {isEncrypted ? "Sealed" : "Seal"}
      </Button>

      {isOpen && (
        <Modal
          title={isEncrypted ? "Sealed snippet" : "Seal this snippet"}
          size="md"
          isBusy={isBusy}
          onClose={close}
          footer={
            isEncrypted ? (
              <>
                <Button variant="secondary" onClick={close} disabled={isBusy}>
                  Close
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void unseal()}
                  disabled={isBusy || password === ""}
                >
                  Unseal for good
                </Button>
                <Button onClick={() => void open()} disabled={isBusy || password === ""}>
                  Open
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={close} disabled={isBusy}>
                  Cancel
                </Button>
                <Button onClick={() => void seal()} disabled={isBusy || password === ""}>
                  Seal
                </Button>
              </>
            )
          }
        >
          <div className="space-y-3 text-sm">
            {!isEncrypted && (
              <p className="text-muted">
                A snippet is often the shape of a credential. Sealing encrypts its
                title and body; the categories, tags and language stay readable so
                it is still findable.{" "}
                <strong className="text-ink">
                  There is no recovery — this library is shared, so forgetting the
                  password loses this snippet for everyone.
                </strong>
              </p>
            )}

            {isEncrypted && passwordHint !== "" && (
              <p className="text-muted">
                Hint: <span className="text-ink">{passwordHint}</span>
              </p>
            )}

            <label className="block text-muted">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`mt-1 ${INPUT_CLASS}`}
              />
            </label>

            {!isEncrypted && (
              <label className="block text-muted">
                Hint (optional, stored in the clear)
                <input
                  type="text"
                  value={hint}
                  placeholder="Never the password itself"
                  onChange={(event) => setHint(event.target.value)}
                  className={`mt-1 ${INPUT_CLASS}`}
                />
              </label>
            )}

            {revealed && (
              <div className="space-y-2">
                <p className="text-ink">{revealed.title || "Untitled snippet"}</p>
                {/* Shown and then forgotten — closing the dialog drops it, and
                    the stored row is untouched. */}
                <pre className="max-h-80 overflow-auto rounded-md bg-paper p-3 font-mono text-xs text-ink">
                  {revealed.code}
                </pre>
                <CopyButton text={revealed.code} label="Copy the snippet" />
              </div>
            )}

            {error !== "" && <p className="text-red-400">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * The per-card Edit button.
 *
 * Takes the id only — see `EditorTarget`. The dialog fetches the full body on
 * open: one round trip on a deliberate click, rather than every body in every
 * list render.
 */
export function EditSnippetButton({ id }: { id: number }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setIsOpen(true)}>
        Edit
      </Button>
      {isOpen && <SnippetEditor target={{ mode: "edit", id }} onClose={() => setIsOpen(false)} />}
    </>
  );
}
