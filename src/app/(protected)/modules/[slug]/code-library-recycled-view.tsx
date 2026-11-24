"use client";

// Recycled Snippets: what deleting a snippet actually did.
//
// Deleting moves a snippet here (migration 0183) and only this screen destroys
// anything. That is the whole reason the bin was built before delete was — until
// it existed, a delete would have been permanent and the module had no undo of
// any kind.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { SNIPPET_LANGUAGE_LABELS, type RecycledSnippet } from "@/lib/code-library";
import {
  emptyRecycleBinAction,
  purgeRecycledSnippetAction,
  restoreRecycledSnippetAction,
} from "./code-library-actions";

export function CodeLibraryRecycledView({ snippets }: { snippets: RecycledSnippet[] }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setIsBusy(true);
    setError("");
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    router.refresh();
  }

  async function handlePurge(snippet: RecycledSnippet) {
    // Named, and explicit that this one is the irreversible step — the delete
    // that got them here was not.
    if (
      !confirm(
        `Permanently remove "${snippet.title || "Untitled snippet"}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await run(() => purgeRecycledSnippetAction(snippet.id));
  }

  async function handleEmpty() {
    if (
      !confirm(
        `Permanently remove all ${snippets.length} snippet${
          snippets.length === 1 ? "" : "s"
        } in the bin? This cannot be undone.`,
      )
    ) {
      return;
    }
    await run(() => emptyRecycleBinAction());
  }

  if (snippets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-8 text-center">
        <p className="font-display text-lg text-ink">The bin is empty</p>
        <p className="mt-1 text-sm text-muted">
          Deleted snippets wait here until you remove them for good.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {snippets.length} {snippets.length === 1 ? "snippet" : "snippets"} in the bin
        </p>
        <Button variant="danger" onClick={() => void handleEmpty()} disabled={isBusy}>
          Empty the bin
        </Button>
      </div>

      {error !== "" && <p className="text-sm text-red-400">{error}</p>}

      <ul className="space-y-3">
        {snippets.map((snippet) => (
          <li key={snippet.id} className="rounded-xl border border-line bg-paper-raised p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="font-display text-base text-ink">
                {snippet.title || "Untitled snippet"}
              </h3>
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted">
                  <span className="text-brass-dark">
                    {SNIPPET_LANGUAGE_LABELS[snippet.language]}
                  </span>
                  {snippet.isEncrypted ? " · sealed" : ` · ${snippet.lineCount} lines`}
                  {" · deleted "}
                  {snippet.deletedAt}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void run(() => restoreRecycledSnippetAction(snippet.id))}
                  disabled={isBusy}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void handlePurge(snippet)}
                  disabled={isBusy}
                >
                  Remove
                </Button>
              </div>
            </div>

            {(snippet.categories.length > 0 || snippet.tags.length > 0) && (
              // The labels are mirrored into the bin and come back on restore,
              // so showing them here is honest about what would return.
              <p className="mt-2 text-xs text-muted">
                {[...snippet.categories, ...snippet.tags].join(" · ")}
              </p>
            )}

            {/* Plain, unhighlighted, and no Copy button: the bin is for deciding
                whether to restore something, not for working out of. A sealed
                snippet shows nothing at all, because there is no plaintext. */}
            {snippet.preview !== "" && (
              <pre className="mt-3 overflow-x-auto rounded-md bg-paper p-3 font-mono text-xs text-muted">
                {snippet.preview}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
