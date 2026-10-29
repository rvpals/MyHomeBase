"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { BusyOverlay } from "@/components/busy-overlay";
import { FileUploaderZone, type AttachedFile } from "@/components/file-uploader-zone";
// From the leaf module, not the barrel: see the note in documents-main-view.tsx — the
// barrel re-exports the file store, which imports `node:fs/promises`.
import type {
  Document,
  DocumentAttachment,
  DocumentTaxonomyItem,
} from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import {
  createDocumentAction,
  removeAttachmentAction,
  updateDocumentAction,
} from "./documents-actions";

// Documents → New / Edit. A full route rather than a modal: a document carries a
// title, a description, two taxonomies and any number of files, which is more than a
// dialog should hold — and a route means a half-filled form survives a refresh.
//
// Narrow: the two columns collapse to one via `max-lg:grid-cols-1`. `FileUploaderZone`
// is a single column at every width, so nothing else needs a compact variant.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function DocumentsEditorView({
  document,
  attachments,
  categories,
  tags,
  maxFileBytes,
  maxFilesPerDocument,
  isFolderConfigured,
}: {
  /** Absent when filing a new document. */
  document?: Document;
  attachments: DocumentAttachment[];
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
  maxFileBytes: number;
  maxFilesPerDocument: number;
  /** False until an admin sets the folder — attaching is refused until then. */
  isFolderConfigured: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(document?.title ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [chosenCategories, setChosenCategories] = useState<string[]>(document?.categories ?? []);
  const [chosenTags, setChosenTags] = useState<string[]>(document?.tags ?? []);

  // The files already on the server, kept in state so a removal disappears from the
  // list at once rather than only after a round trip.
  const [attached, setAttached] = useState<DocumentAttachment[]>(attachments);
  const [pending, setPending] = useState<File[]>([]);

  const [error, setError] = useState<string>();
  const [busyMessage, setBusyMessage] = useState<string>();

  const isEditing = document !== undefined;

  const attachedFiles: AttachedFile[] = attached.map((file) => ({
    id: file.id,
    name: file.originalName,
    byteSize: file.byteSize,
    href: `/api/documents/${file.documentId}/attachments/${file.id}`,
  }));

  /**
   * Uploads the pending files to a document that already exists.
   *
   * A route handler rather than a server action, because a server action's body limit
   * is about 1 MB and a scan is not. Returns the names that were refused so the form
   * can name them instead of silently dropping them.
   */
  async function uploadPending(documentId: number): Promise<string[]> {
    if (pending.length === 0) return [];
    const form = new FormData();
    for (const file of pending) form.append("files", file);

    const response = await fetch(`/api/documents/${documentId}/attachments`, {
      method: "POST",
      body: form,
    });

    if (!response.ok && response.status !== 200) {
      const body = await response.json().catch(() => undefined);
      throw new Error(body?.error ?? "The upload failed.");
    }

    const result = (await response.json()) as {
      ok: boolean;
      stored: number[];
      failed: { name: string; error: string }[];
    };
    return result.failed.map((entry) => `${entry.name}: ${entry.error}`);
  }

  function save() {
    setError(undefined);
    startTransition(async () => {
      try {
        setBusyMessage(isEditing ? "Saving…" : "Filing…");

        // The record is written first, because an upload needs a document to hang
        // from. On a new document that is also what produces the id.
        let documentId = document?.id;
        if (isEditing) {
          const result = await updateDocumentAction({
            id: document.id,
            title,
            description,
            categories: chosenCategories,
            tags: chosenTags,
          });
          if (!result.ok) throw new Error(result.error ?? "Could not save that document.");
        } else {
          const result = await createDocumentAction({
            title,
            description,
            categories: chosenCategories,
            tags: chosenTags,
          });
          if (!result.ok || result.id === undefined) {
            throw new Error(result.error ?? "Could not file that document.");
          }
          documentId = result.id;
        }

        if (pending.length > 0) {
          setBusyMessage(`Uploading ${pending.length} ${pending.length === 1 ? "file" : "files"}…`);
          const failures = await uploadPending(documentId!);
          if (failures.length > 0) {
            // The document itself saved — only some files did not. Say exactly which,
            // and stay on the form so they can be re-picked.
            setBusyMessage(undefined);
            setPending([]);
            setError(
              `The document was saved, but these files were not attached — ${failures.join("; ")}`,
            );
            router.refresh();
            return;
          }
        }

        setBusyMessage(undefined);
        router.push("/modules/documents");
        router.refresh();
      } catch (caught) {
        setBusyMessage(undefined);
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    });
  }

  function removeAttached(attachmentId: number) {
    const file = attached.find((entry) => entry.id === attachmentId);
    if (!file) return;

    // Asked here rather than in a second dialog: it is one question with two outcomes,
    // and the wording states both. Cancelling removes nothing at all.
    const deleteFile = window.confirm(
      `Remove “${file.originalName}” from this document?\n\n` +
        "OK — also move the file to the _deleted folder on the server.\n" +
        "Cancel — keep the file on the server and leave it attached.",
    );
    if (!deleteFile) return;

    setError(undefined);
    startTransition(async () => {
      const result = await removeAttachmentAction(attachmentId, true);
      if (!result.ok) {
        setError(result.error ?? "Could not remove that attachment.");
        return;
      }
      setAttached((current) => current.filter((entry) => entry.id !== attachmentId));
      router.refresh();
    });
  }

  return (
    <div className={PAGE_CONTAINER}>
      <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Title</span>
            <input
              className={INPUT_CLASS}
              value={title}
              placeholder="Flat lease 2026"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Description
            </span>
            <textarea
              className={`${INPUT_CLASS} min-h-28`}
              value={description}
              placeholder="What this is, and where the original lives."
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <TaxonomyPicker
            label="Categories"
            hint="What kind of document this is."
            available={categories}
            chosen={chosenCategories}
            onChange={setChosenCategories}
          />

          <TaxonomyPicker
            label="Tags"
            hint="What it is about."
            available={tags}
            chosen={chosenTags}
            onChange={setChosenTags}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Files</span>
            {isFolderConfigured ? (
              <FileUploaderZone
                attached={attachedFiles}
                onRemoveAttached={removeAttached}
                pending={pending}
                onPendingChange={setPending}
                maxFiles={maxFilesPerDocument}
                maxFileBytes={maxFileBytes}
                disabled={isPending}
                // Dropping files IS the task on this screen, and the zone has its own
                // column to fill — so it gets the tall target rather than the
                // form-field height the import screens want.
                size="tall"
              />
            ) : (
              <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
                No document folder is set, so files cannot be attached yet. An
                administrator can set one in Documents → Configuration. The document
                itself can still be filed.
              </p>
            )}
          </div>

          {!isEditing && pending.length > 0 && (
            <p className="text-xs text-muted">
              The document is filed first, then its files are uploaded — so a file that
              is refused does not lose what you typed.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={isPending || title.trim() === ""}
          onClick={save}
        >
          {isEditing ? "Save changes" : "File document"}
        </Button>
        <Button variant="secondary" disabled={isPending} href="/modules/documents">
          Cancel
        </Button>
      </div>

      <BusyOverlay
        isBusy={busyMessage !== undefined}
        message={busyMessage ?? ""}
        progress="indeterminate"
      />
    </div>
  );
}

/**
 * Pick from the existing list, or type a new name.
 *
 * Local to this screen rather than shared: it is two inputs and a chip row, and
 * nothing else needs it yet. Promote it on the second caller, per ARCHITECTURE.md.
 */
function TaxonomyPicker({
  label,
  hint,
  available,
  chosen,
  onChange,
}: {
  label: string;
  hint: string;
  available: DocumentTaxonomyItem[];
  chosen: string[];
  onChange: (names: string[]) => void;
}) {
  const [typed, setTyped] = useState("");

  function add(name: string) {
    const trimmed = name.trim();
    if (trimmed === "") return;
    // Case-insensitive, matching the taxonomy tables: "Tax" and "tax" are one name,
    // and two chips that look identical would be a bug the reader cannot fix.
    if (chosen.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...chosen, trimmed]);
    setTyped("");
  }

  const unchosen = available.filter(
    (item) => !chosen.some((name) => name.toLowerCase() === item.name.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="text-xs text-muted">{hint}</span>

      {chosen.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {chosen.map((name) => (
            <li
              key={name}
              className="flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                className="text-muted hover:text-red-400"
                onClick={() => onChange(chosen.filter((entry) => entry !== name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex gap-2 max-lg:flex-col">
        <input
          className={`${INPUT_CLASS} flex-1`}
          value={typed}
          placeholder={`Add a ${label.toLowerCase().replace(/s$/, "")}`}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(typed);
            }
          }}
        />
        {unchosen.length > 0 && (
          <select
            className={INPUT_CLASS}
            value=""
            onChange={(event) => add(event.target.value)}
          >
            {/* Blank first, and the value stays "" so this reads as an action rather
                than a current selection — a <select> whose value matches no option
                silently shows the first one. */}
            <option value="">Pick existing…</option>
            {unchosen.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
