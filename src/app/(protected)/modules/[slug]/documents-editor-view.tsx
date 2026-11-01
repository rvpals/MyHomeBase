"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { BusyOverlay } from "@/components/busy-overlay";
import { FileUploaderZone, type AttachedFile } from "@/components/file-uploader-zone";
import { TokenPicker } from "@/components/token-picker";
// From the leaf modules, not the barrel: see the note in documents-main-view.tsx —
// the barrel re-exports the file store, which imports `node:fs/promises`. `prefill.ts`
// itself imports only types and the schema, so reaching it directly is safe.
import {
  applyPrefillTemplate,
  formStateToPrefillValues,
  prefillValuesToFormState,
} from "@/lib/documents/prefill";
import type {
  Document,
  DocumentAttachment,
  DocumentPrefillTemplate,
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
  prefillTemplates = [],
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
  /**
   * Enabled prefill templates, for the form's picker (migration 0169).
   *
   * Empty when editing: the route hands them down only for `new`. Prefilling a
   * document that already exists is a different gesture, and offering it here would
   * invite a filer to half-overwrite something they filed months ago.
   */
  prefillTemplates?: DocumentPrefillTemplate[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(document?.title ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [chosenCategories, setChosenCategories] = useState<string[]>(document?.categories ?? []);
  const [chosenTags, setChosenTags] = useState<string[]>(document?.tags ?? []);

  // `TokenPicker` takes plain names; the taxonomy rows carry counts and ids the
  // form has no use for.
  const categoryNames = categories.map((item) => item.name);
  const tagNames = tags.map((item) => item.name);

  // The files already on the server, kept in state so a removal disappears from the
  // list at once rather than only after a round trip.
  const [attached, setAttached] = useState<DocumentAttachment[]>(attachments);
  const [pending, setPending] = useState<File[]>([]);

  const [error, setError] = useState<string>();
  /**
   * Files that attached but already exist elsewhere in the library (migration 0163).
   *
   * Separate from `error` because it is not one: everything saved. Keeping them apart
   * stops a notice being styled, worded or dismissed as a failure.
   */
  const [duplicateNotice, setDuplicateNotice] = useState<string[]>();
  const [busyMessage, setBusyMessage] = useState<string>();

  const isEditing = document !== undefined;

  // Which template the picker is showing. Local to the control: applying copies values
  // into the four field states and nothing afterwards depends on which template they
  // came from — the same "copied, not linked" rule migration 0169 records.
  const [prefillId, setPrefillId] = useState("");

  /**
   * Fills the blank fields from the chosen template.
   *
   * The merge itself is `applyPrefillTemplate` in lib — this only maps between the
   * form's four pieces of state and the flat string shape the merge works on, through
   * the two converters that own the comma-splitting rule.
   */
  function applyPrefill(rawId: string) {
    setPrefillId(rawId);
    const template = prefillTemplates.find((candidate) => String(candidate.id) === rawId);
    if (!template) return;

    const filled = prefillValuesToFormState(
      applyPrefillTemplate(
        template,
        formStateToPrefillValues({
          title,
          description,
          categories: chosenCategories,
          tags: chosenTags,
        }),
      ),
    );

    setTitle(filled.title);
    setDescription(filled.description);
    setChosenCategories(filled.categories);
    setChosenTags(filled.tags);
  }

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
   * is about 1 MB and a scan is not.
   *
   * Returns two lists, and they mean opposite things. `failures` are files that did
   * NOT attach, which is an error the form has to stay open for. `duplicates` DID
   * attach — they are advisory, flagging that the same bytes are already filed
   * elsewhere (migration 0163), and the save goes through regardless.
   */
  async function uploadPending(
    documentId: number,
  ): Promise<{ failures: string[]; duplicates: string[] }> {
    if (pending.length === 0) return { failures: [], duplicates: [] };
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
      duplicates?: { name: string; alsoIn: string[] }[];
    };
    return {
      failures: result.failed.map((entry) => `${entry.name}: ${entry.error}`),
      // Advisory: these files DID attach. Migration 0163.
      duplicates: (result.duplicates ?? []).map(
        (entry) => `${entry.name} is already attached to ${entry.alsoIn.join(", ")}`,
      ),
    };
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
          const { failures, duplicates } = await uploadPending(documentId!);
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
          if (duplicates.length > 0) {
            // Everything saved and every file attached — this is a notice, not an
            // error, so it is worded as one. Staying on the form is the point: the
            // reader can only act on "you already have this" while they are still
            // here, and navigating away would make the warning pointless.
            setBusyMessage(undefined);
            setPending([]);
            setDuplicateNotice(duplicates);
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
          {/* Only when there is something to pick. An empty dropdown on the New
              Document form would be a control that explains nothing about why it is
              empty — the Templates screen is where templates are made. */}
          {prefillTemplates.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Prefill template
              </span>
              <select
                className={INPUT_CLASS}
                value={prefillId}
                onChange={(event) => applyPrefill(event.target.value)}
              >
                <option value="">Start from blank</option>
                {prefillTemplates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {template.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                Fills only the fields you have left blank — nothing you have already typed or
                chosen is replaced.
              </span>
            </label>
          )}

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

          {/* The shared combobox, the same control the journal's Categories and Tags
              use (components.md → TokenPicker). It replaced this screen's local
              picker — a create `<input>` beside a "Pick existing…" `<select>` — which
              was two controls to squeeze into one column and gave a typo its own
              silent new category. */}
          <TokenPicker
            label="Categories"
            hint="What kind of document this is."
            value={chosenCategories}
            onChange={setChosenCategories}
            options={categoryNames}
            allowCreate
            createPlaceholder="Filter or add a category…"
          />

          <TokenPicker
            label="Tags"
            hint="What it is about."
            value={chosenTags}
            onChange={setChosenTags}
            options={tagNames}
            allowCreate
            createPlaceholder="Filter or add a tag…"
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

      {duplicateNotice && (
        <div className="mt-4 rounded-md border border-line bg-paper px-3 py-2 text-sm">
          <p className="text-ink">
            Saved. The library already holds the same file{" "}
            {duplicateNotice.length === 1 ? "as this one" : "as some of these"}:
          </p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {duplicateNotice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Filing the same file twice is sometimes what you want, so it was attached
            anyway. Remove it below if it was not.
          </p>
        </div>
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
