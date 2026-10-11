"use client";

// A modal that walks the SERVER's folders one level at a time, so a reader can
// pick a directory the server can actually write to.
//
// The server's, not the reader's: a browser file dialog never hands the page a real
// path, and the folders being chosen here (a receipt root, a backup destination) have
// to be ones the server can reach anyway. Only folders are listed — the choice being
// made is a folder.
//
// Lifted out of `household-configuration-view.tsx`, where it was a private function,
// when the Backup Data screen needed the same control. The one coupling it had was a
// direct import of the household module's `browseFoldersAction`; that is now the
// `onBrowse` prop, so this file imports no lib and no action. Each caller passes its
// own action, which is also what keeps each screen's own `requireAdmin()` check at the
// boundary where it belongs rather than inside a shared component.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";

/**
 * One level of the server's folder tree.
 *
 * Structurally identical to `FolderListing` in `src/lib/household/receipt-store.ts`
 * and declared again here rather than imported: a component may import types from
 * `lib`, but duplicating three fields keeps this file free of any module's domain
 * and lets a second caller supply the same shape from its own port.
 */
export interface FolderBrowserListing {
  /** The folder being shown, as the server resolved it. */
  path: string;
  /** Its parent, or `null` at a filesystem root. */
  parent: string | null;
  /** Sub-folder names, alphabetical. */
  folders: string[];
}

/** What a caller's browse action must return. Mirrors the existing action results. */
export interface FolderBrowserResult {
  ok: boolean;
  listing?: FolderBrowserListing;
  error?: string;
}

export interface FolderBrowserProps {
  /** Where the dialog opens. Blank starts at the server's filesystem root. */
  startPath: string;
  /**
   * Lists one folder on the server. Supplied by the caller so this component is
   * tied to no module and no action — see the note at the top of the file.
   */
  onBrowse: (path: string) => Promise<FolderBrowserResult>;
  onCancel: () => void;
  onPick: (path: string) => void;
  /**
   * One line under the list, for a caller that needs to say what *kind* of folder
   * is wanted (the HSA screen asks for the parent of the year folders). Omitted
   * when the folder's purpose is already obvious from the screen.
   */
  hint?: string;
}

export function FolderBrowser({
  startPath,
  onBrowse,
  onCancel,
  onPick,
  hint,
}: FolderBrowserProps) {
  const [listing, setListing] = useState<FolderBrowserListing>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Loads on first render and on every navigation. `useState` + this flag rather than
  // `useEffect`: there is exactly one load in flight and the dialog owns it.
  const [requested, setRequested] = useState<string>();

  async function open(path: string) {
    setIsLoading(true);
    setError(undefined);
    const result = await onBrowse(path);
    setIsLoading(false);
    if (!result.ok || !result.listing) {
      setError(result.error ?? "Could not open that folder.");
      return;
    }
    setListing(result.listing);
  }

  if (requested === undefined) {
    setRequested(startPath);
    void open(startPath);
  }

  return (
    <Modal
      title="Choose a folder"
      description={listing?.path ?? "Loading…"}
      size="lg"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!listing || isLoading}
            onClick={() => listing && onPick(listing.path)}
          >
            Use this folder
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isLoading || !listing?.parent}
            onClick={() => listing?.parent && open(listing.parent)}
          >
            ↑ Up one level
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted">Reading the folder…</p>
        ) : (
          <ul className="panel-inset flex max-h-80 flex-col overflow-auto rounded-md bg-paper">
            {listing?.folders.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">
                No sub-folders here. &ldquo;Use this folder&rdquo; chooses it as it is.
              </li>
            )}
            {listing?.folders.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper-raised"
                  onClick={() => open(`${listing.path.replace(/[/\\]+$/, "")}/${name}`)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </Modal>
  );
}
