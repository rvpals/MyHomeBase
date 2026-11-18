"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BulkConfirm } from "@/components/bulk-confirm";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { notifyResult } from "@/components/toast-notify";
// From the leaf modules, NOT the barrel: this is a client component, and
// `@/lib/documents` re-exports the repository and the file store, which pull in
// `better-sqlite3` and `node:fs/promises`. Same reasoning as documents-main-view.tsx.
import { isInlineRenderable } from "@/lib/documents/attachment-path";
import { formatBytes } from "@/lib/documents/schema";
import type { DuplicateAttachment, DuplicateGroup } from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import { backfillContentHashesAction, removeAttachmentAction } from "./documents-actions";
import { documentsEditorHref } from "./documents-sections";

// Documents → Document Review. One card for now — "Check for duplicate attachments" —
// with room for more checks of the same kind below it.
//
// ## What the duplicate card does
//
// Lists every set of attachments that share their bytes (SHA-256, migration 0163), and
// nothing else: a file that occurs once never appears. Each copy links to its document
// in the editor, opens on its own, or can be removed from its document — which moves
// the stored file to `_deleted/` exactly as the editor's own remove does. Once a set is
// down to one copy it drops off the list on the refresh that follows.
//
// ## Files not checked yet
//
// Rows uploaded before 0163 carry no hash and so cannot be matched. The card says how
// many, and "Check these files now" runs the same backfill as the CLI in batches of
// 50, with a Stop button. A file missing from the share stays unchecked and is named.
//
// ## Narrow screens
//
// Each set is a bordered block; each copy is a row whose actions wrap onto their own
// line below 1024px (`max-lg:` variants only, so the desktop layout cannot regress).
// No compact-only component.

export interface DocumentsReviewViewProps {
  groups: DuplicateGroup[];
  unhashedCount: number;
  isFolderConfigured: boolean;
}

export function DocumentsReviewView({
  groups,
  unhashedCount,
  isFolderConfigured,
}: DocumentsReviewViewProps) {
  return (
    <div className={`${PAGE_CONTAINER} flex flex-col gap-4`}>
      <CollapsibleCard title="Check for duplicate attachments" defaultOpen>
        <div className="flex flex-col gap-4">
          <DuplicateInstructions />
          <UncheckedFiles count={unhashedCount} isFolderConfigured={isFolderConfigured} />
          <DuplicateList groups={groups} />
        </div>
      </CollapsibleCard>
    </div>
  );
}

function DuplicateInstructions() {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <p>
        Each block below is <strong className="text-ink">one file the library holds more
        than once</strong> — the same bytes, whatever each copy is called. Files that
        appear only once are not listed.
      </p>
      <p>
        For each block, decide which document should keep the file. Click a document&apos;s
        title to open it in the editor, <strong className="text-ink">Open file</strong> to
        look at that copy, or <strong className="text-ink">Remove</strong> to take that copy
        off its document. A removed file is moved to the <code>_deleted</code> folder on the
        server, not erased.
      </p>
      <p>
        Keeping the same file on two documents is sometimes right — a receipt that is both
        a warranty and a tax record. Nothing here removes anything on its own.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files not checked yet — the backfill link
// ---------------------------------------------------------------------------

interface BackfillProgress {
  hashed: number;
  remaining: number;
  duplicates: number;
  missing: string[];
}

function UncheckedFiles({
  count,
  isFolderConfigured,
}: {
  count: number;
  isFolderConfigured: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress>();
  const [error, setError] = useState<string>();
  const stopRequested = useRef(false);

  async function run() {
    setRunning(true);
    setError(undefined);
    stopRequested.current = false;
    const totals: BackfillProgress = { hashed: 0, remaining: count, duplicates: 0, missing: [] };
    setProgress({ ...totals });

    let afterId = 0;
    let failed: string | undefined;
    try {
      // One batch per call, so each request stays short and Stop takes effect between
      // batches. An empty batch means everything after the cursor has been looked at.
      while (!stopRequested.current) {
        const result = await backfillContentHashesAction(afterId);
        if (!result.ok) {
          failed = result.error ?? "Could not check those files.";
          setError(failed);
          break;
        }
        totals.hashed += result.hashed ?? 0;
        totals.duplicates += result.duplicates ?? 0;
        totals.missing = [...totals.missing, ...(result.missing ?? [])];
        totals.remaining = result.remaining ?? totals.remaining;
        setProgress({ ...totals });
        if ((result.examined ?? 0) === 0) break;
        afterId = result.lastId ?? afterId;
      }
    } catch (caught) {
      // A dropped connection mid-run. Batches already done are saved; a rerun resumes.
      failed = caught instanceof Error ? caught.message : "The check was interrupted.";
      setError(failed);
    } finally {
      setRunning(false);
      notifyResult(
        { ok: failed === undefined, error: failed },
        `Checked ${totals.hashed} file${totals.hashed === 1 ? "" : "s"}`,
        "check the files",
      );
      router.refresh();
    }
  }

  if (count === 0 && progress === undefined) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm">
      {count > 0 && !running && (
        <p className="text-ink">
          <strong>{count}</strong> file{count === 1 ? " has" : "s have"} not been checked yet,
          so {count === 1 ? "it is" : "they are"} not part of this list.
        </p>
      )}

      {running && progress && (
        <p className="text-ink" aria-live="polite">
          Checking… {progress.hashed} done, {progress.remaining} still unchecked.
        </p>
      )}

      {!running && progress && (
        <p className="text-muted" aria-live="polite">
          Checked {progress.hashed} file{progress.hashed === 1 ? "" : "s"}
          {progress.duplicates > 0 ? `, found ${progress.duplicates} new duplicate(s)` : ""}.
        </p>
      )}

      {progress && progress.missing.length > 0 && (
        <p className="text-muted">
          Missing from the server, so left unchecked: {progress.missing.join(", ")}.
        </p>
      )}

      {error && <p className="text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => (stopRequested.current = true)}>
            Stop
          </Button>
        ) : (
          count > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={run}
              disabled={!isFolderConfigured}
              title={isFolderConfigured ? undefined : "Set the document folder in Configuration first."}
            >
              Check these files now
            </Button>
          )
        )}
      </div>
      {!isFolderConfigured && count > 0 && (
        <p className="text-xs text-muted">
          No document folder is set, so there are no files to read. Set it under
          Configuration.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The duplicate list
// ---------------------------------------------------------------------------

function DuplicateList({ groups }: { groups: DuplicateGroup[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingRemove, setPendingRemove] = useState<DuplicateAttachment>();
  const [error, setError] = useState<string>();

  function remove(file: DuplicateAttachment) {
    setError(undefined);
    startTransition(async () => {
      const result = await removeAttachmentAction(file.attachmentId, true);
      notifyResult(result, "Attachment removed", "remove the attachment");
      setPendingRemove(undefined);
      if (!result.ok) {
        setError(result.error ?? "Could not remove that attachment.");
        return;
      }
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return <p className="text-sm text-muted">No duplicate attachments found.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        <strong>{groups.length}</strong> file{groups.length === 1 ? " is" : "s are"} attached
        more than once.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}

      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <li
            key={group.contentHash}
            className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3"
          >
            <p className="text-xs text-muted">
              {formatBytes(group.byteSize)} · {group.files.length} copies ·{" "}
              <span title={group.contentHash} className="font-mono">
                {group.contentHash.slice(0, 12)}
              </span>
            </p>
            <ul className="flex flex-col gap-1">
              {group.files.map((file) => (
                <DuplicateRow
                  key={file.attachmentId}
                  file={file}
                  disabled={isPending}
                  onRemove={() => setPendingRemove(file)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {pendingRemove && (
        <BulkConfirm
          title="Remove this copy?"
          description={`“${pendingRemove.originalName}” is taken off “${pendingRemove.documentTitle}”. The file is moved to the _deleted folder on the server, not erased.`}
          count={1}
          noun={{ one: "file", many: "files" }}
          confirmLabel="Remove"
          isBusy={isPending}
          onConfirm={() => remove(pendingRemove)}
          onCancel={() => setPendingRemove(undefined)}
        />
      )}
    </div>
  );
}

function DuplicateRow({
  file,
  disabled,
  onRemove,
}: {
  file: DuplicateAttachment;
  disabled: boolean;
  onRemove: () => void;
}) {
  const opens = isInlineRenderable(file.mimeType);
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm max-lg:flex-col max-lg:items-stretch">
      <span className="flex min-w-0 flex-col">
        <Link
          href={documentsEditorHref(file.documentId)}
          className="truncate font-medium text-ink underline-offset-2 hover:text-brass hover:underline"
          title={`Open “${file.documentTitle}” in the editor`}
        >
          {file.documentTitle}
        </Link>
        <span className="truncate text-xs text-muted" title={file.originalName}>
          {file.originalName} · added {file.createdAt.slice(0, 10)}
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap gap-2">
        {/* A plain anchor, not `Button href`: that renders a `next/link`, which cannot
            open a new tab and would try to client-route to a file. Same as the Home
            screen's file list. */}
        <a
          href={`/api/documents/${file.documentId}/attachments/${file.attachmentId}`}
          target="_blank"
          rel="noreferrer"
          title={opens ? "Opens in a new tab" : "Downloads the file"}
          className="inline-flex items-center rounded-md border border-line bg-paper px-3 py-1 text-sm text-ink hover:border-brass"
        >
          {opens ? "Open file ↗" : "Download ↓"}
        </a>
        <Button size="sm" variant="secondary" href={documentsEditorHref(file.documentId)}>
          Edit document
        </Button>
        <Button size="sm" variant="danger" onClick={onRemove} disabled={disabled}>
          Remove
        </Button>
      </span>
    </li>
  );
}
