"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FolderBrowser } from "@/components/folder-browser";
// From the leaf module, not the barrel: see the note in documents-main-view.tsx --
// the barrel re-exports the file store, which imports `node:fs/promises`.
import { formatBytes } from "@/lib/documents/schema";
import { PAGE_CONTAINER } from "../../page-container";
import {
  browseFoldersAction,
  checkDocumentRootAction,
  saveDocumentRootAction,
} from "./documents-actions";

// Documents → Configuration. Admin-only for the folder (the actions check; this view
// only presents). Mirrors the Household's receipt-folder panel, including Check access,
// which writes a probe file rather than trusting `access(W_OK)` — on an SMB share that
// can report writable for a folder that then refuses the write.
//
// The size and count limits are shown here but SET in Admin → Configuration: they bound
// what the server will buffer rather than expressing a preference about documents, so
// they belong beside the other operational limits. Shown read-only so an administrator
// who is looking at this screen can still see what is in force — the same reason
// `modules.md` has a background job's preconditions echoed on the module's own screen.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function DocumentsConfigurationView({
  documentRoot,
  maxFileBytes,
  maxFilesPerDocument,
  canEdit,
}: {
  documentRoot: string;
  maxFileBytes: number;
  maxFilesPerDocument: number;
  /** Whether this reader is an admin. The actions enforce it; this only hides. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [path, setPath] = useState(documentRoot);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function save() {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await saveDocumentRootAction(path);
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that folder.");
      return;
    }
    setNotice(path.trim() === "" ? "The document folder is cleared." : "Saved.");
    router.refresh();
  }

  async function check() {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await checkDocumentRootAction(path);
    setIsBusy(false);
    if (result.ok) setNotice(result.message);
    else setError(result.error ?? "Could not check that folder.");
  }

  // Unsaved as soon as the box differs from what is stored — Save is the only thing
  // that writes, and Check deliberately does not.
  const isDirty = path.trim() !== documentRoot;

  return (
    <div className={PAGE_CONTAINER}>
      <div className="flex flex-col gap-4">
        <CollapsibleCard title="Document folder" defaultOpen>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Where a document&apos;s files are kept. Inside it, one folder per document
              is created as needed — <code className="text-ink">doc_17</code>,{" "}
              <code className="text-ink">doc_18</code> — holding that document&apos;s
              files under their own names. Until this is set, a file cannot be attached.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Folder on the server
              </span>
              <div className="flex gap-2 max-lg:flex-col">
                <input
                  className={`${INPUT_CLASS} flex-1`}
                  value={path}
                  placeholder="//NAS_DS223/app/myhomebase/documents"
                  disabled={!canEdit}
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={isBusy || !canEdit}
                  onClick={() => setIsBrowsing(true)}
                >
                  Browse…
                </Button>
              </div>
            </label>

            <p className="text-xs text-muted">
              This is a path on the machine running MyHomeBase, not on your phone or
              laptop — so Browse lists the server&apos;s own folders.
            </p>

            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={isBusy || !isDirty} onClick={save}>
                  {isBusy ? "Working…" : "Save folder"}
                </Button>
                <Button variant="secondary" disabled={isBusy} onClick={check}>
                  Check access
                </Button>
                {isDirty && (
                  <Button
                    variant="secondary"
                    disabled={isBusy}
                    onClick={() => {
                      setPath(documentRoot);
                      setError(undefined);
                      setNotice(undefined);
                    }}
                  >
                    Revert
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Only an administrator can change this folder.
              </p>
            )}

            {notice && (
              <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
                {notice}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
              >
                {error}
              </p>
            )}

            <p className="text-xs text-muted">
              Changing this folder does not move any existing file. Files are recorded
              relative to it, so pointing this at a copy keeps every document working,
              and pointing it somewhere empty leaves them unreachable until the files
              are copied across.
            </p>
          </div>
        </CollapsibleCard>

        <CollapsibleCard title="Upload limits">
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 text-sm max-lg:grid-cols-1">
              <div className="flex flex-col">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                  Largest file
                </dt>
                <dd className="text-ink">{formatBytes(maxFileBytes)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                  Files per document
                </dt>
                <dd className="text-ink">{maxFilesPerDocument}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted">
              Set in Administration → Configuration, not here: these bound what the
              server will hold in memory during an upload, so they sit with the other
              operational limits rather than with this module&apos;s own settings.
            </p>
          </div>
        </CollapsibleCard>
      </div>

      {isBrowsing && (
        <FolderBrowser
          startPath={path}
          onBrowse={browseFoldersAction}
          onCancel={() => setIsBrowsing(false)}
          onPick={(picked) => {
            setPath(picked);
            setIsBrowsing(false);
            setNotice(undefined);
            setError(undefined);
          }}
          hint="Pick the folder the per-document folders should be created in."
        />
      )}
    </div>
  );
}
