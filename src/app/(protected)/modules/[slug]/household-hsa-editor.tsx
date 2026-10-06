"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { IconSelect, type IconSelectOption } from "@/components/icon-select";
import { MultiFileDropzone } from "@/components/multi-file-dropzone";
import { HSA_TYPES, type HsaType } from "@/lib/household/hsa-types";
import { toLocalTimeLabel, todayIsoLocal } from "@/lib/shared/date";
import {
  HSA_RECEIPT_PICKABLE_MIME_TYPES,
} from "@/lib/household/hsa-schema";
import {
  prepareReceipt,
  type PreparedReceipt,
  type ReceiptSource,
} from "./household-hsa-receipt-file";

/**
 * Past values as combobox rows.
 *
 * `IconSelect` is the app's one free-text combobox — `allowFreeText` defaults to true,
 * so typing both filters the list and commits whatever is typed. No `iconUrl`: these
 * are plain strings, and the component indents an icon-less row so labels stay aligned.
 *
 * Used instead of a `datalist` (which is what these two fields were) because a
 * datalist has no visible affordance at all — no arrow, and most browsers only suggest
 * once you start typing, so a reader cannot tell the suggestions exist. This opens on
 * focus and on click.
 */
function suggestionOptions(values: string[]): IconSelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * What the dropzone's picker offers.
 *
 * The allowlist, plus extensions — a file dialog matches those more reliably than a
 * MIME type, which is why the CSV importer pairs them too. `image/*` is included so a
 * phone's photo library is not greyed out when it reports a type this list does not
 * name; anything genuinely outside the allowlist is still refused on the way in, by
 * `prepareReceipt` and again on the server.
 */
const RECEIPT_ACCEPT = [
  ...HSA_RECEIPT_PICKABLE_MIME_TYPES,
  "image/*",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
].join(",");

// The add/edit dialog for one HSA expense. Pure presentation: it holds no state of its
// own beyond a file-picker error — the form, the held receipt and the save live in
// `HouseholdHsaView`, which owns the dialog (the same split as the recipe editor).

/** The editor's form, as strings, the way inputs hold them. */
export interface HsaForm {
  entryDate: string;
  entryTime: string;
  amount: string;
  productService: string;
  type: HsaType;
  payee: string;
  serviceDate: string;
  paidWith: string;
  note: string;
  isReimbursed: boolean;
}

/**
 * What the dialog will do with the receipt on save.
 *
 * `keep` is the default for an edit, so saving the form never touches a stored file.
 * A held `new` receipt is only posted after the expense row exists — a new expense
 * has no id to attach it to until then.
 */
export type HsaReceiptChoice =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "new"; upload: PreparedReceipt; previewUrl?: string };

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

export function HsaEditor({
  form,
  expenseId,
  existingReceiptName,
  receipt,
  activeCards,
  productServices,
  payees,
  canAttachReceipt,
  isNew,
  isBusy,
  error,
  onChange,
  onReceipt,
  onCancel,
  onSave,
}: {
  form: HsaForm;
  /** Set when editing, so a stored receipt can be linked. */
  expenseId?: number;
  /** The stored receipt's file name, or empty when the expense has none. */
  existingReceiptName: string;
  receipt: HsaReceiptChoice;
  /** Names of the active cards — the Paid with pick list. */
  activeCards: string[];
  /** Every product or service already recorded, for the autocomplete. */
  productServices: string[];
  /** Every payee already recorded, for the autocomplete. */
  payees: string[];
  /** False when no receipt folder is configured — attaching is impossible until it is. */
  canAttachReceipt: boolean;
  isNew: boolean;
  isBusy: boolean;
  error?: string;
  onChange: (form: HsaForm) => void;
  onReceipt: (choice: HsaReceiptChoice) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<HsaForm>) => onChange({ ...form, ...patch });
  // Only the camera needs its own input now: the dropzone owns the file picker.
  const cameraInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string>();
  const [isReading, setIsReading] = useState(false);
  // Removing a STORED receipt deletes the file from the folder on save, so it is
  // confirmed. Discarding a file chosen a moment ago deletes nothing and is not.
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  /**
   * What the dropzone is showing.
   *
   * Held here rather than derived from `receipt`, because a zip cannot be taken apart
   * again — once several files are packed, the list is the only record of what went in,
   * and removing a row has to re-pack the rest. The prepared upload and this list are
   * written together in `handleFiles`.
   */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Releases the last preview URL when the dialog goes away. Kept in a ref rather than
  // read from `receipt` inside the cleanup, so the effect does not re-run — and revoke
  // a URL that is still on screen — every time the held receipt changes.
  const previewUrlRef = useRef<string | undefined>(undefined);
  previewUrlRef.current = receipt.kind === "new" ? receipt.previewUrl : undefined;
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // A card that was deactivated or deleted since this expense was entered must still
  // show as the selected value, or opening the editor would silently blank it on save.
  const paidWithOptions =
    form.paidWith && !activeCards.includes(form.paidWith)
      ? [form.paidWith, ...activeCards]
      : activeCards;

  async function handleFiles(files: File[], source: ReceiptSource) {
    setFileError(undefined);

    // Emptying the dropzone clears the held upload rather than preparing nothing. It
    // does NOT mark a stored receipt for removal — that is the Remove button, which
    // warns first, because this one only ever drops a file not yet saved.
    if (files.length === 0) {
      setPendingFiles([]);
      if (receipt.kind === "new") {
        if (receipt.previewUrl) URL.revokeObjectURL(receipt.previewUrl);
        onReceipt({ kind: "keep" });
      }
      return;
    }

    setIsReading(true);
    try {
      const upload = await prepareReceipt(files, source);
      // The previous preview's URL pins its blob in memory until it is revoked, and
      // re-picking a photo would otherwise strand one per attempt. Revoked here rather
      // than on unmount because this is the only place one is replaced; the last one
      // is released by the effect below.
      if (receipt.kind === "new" && receipt.previewUrl) URL.revokeObjectURL(receipt.previewUrl);
      // A camera shot replaces the list; it is one file and did not come from the
      // dropzone. An attach IS the list.
      setPendingFiles(files);
      onReceipt({
        kind: "new",
        upload,
        // An object URL rather than a data URL: the bytes never become a string,
        // which is the whole point of the blob path.
        previewUrl: upload.mimeType.startsWith("image/")
          ? URL.createObjectURL(upload.blob)
          : undefined,
      });
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : "That file could not be read.");
    } finally {
      setIsReading(false);
    }
  }

  const hasStored = existingReceiptName !== "" && receipt.kind !== "remove";

  return (
    <Modal
      title={isNew ? "Add an HSA expense" : "Edit HSA expense"}
      size="lg"
      isBusy={isBusy}
      onClose={onCancel}
      footer={
        <Button variant="primary" disabled={isBusy || isReading} onClick={onSave}>
          {isBusy ? "Saving…" : "Save Expense"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        {/* Directly under the title rather than in the title bar: `Modal`'s header
            right-hand side is window chrome (minimize / maximize / close), and a
            content control wedged beside the ✕ reads as chrome and risks being hit
            instead of it. Full width on a phone so it is a comfortable tap target. */}
        <div className="flex max-lg:flex-col">
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() =>
              // Read at the moment of the click, not when the dialog opened: on a form
              // left sitting, the stamp should be when you asked for it. Browser-side
              // for the reason the Journal's entry form is — the clock that matters is
              // the writer's, not the server's.
              set({ entryDate: todayIsoLocal(), entryTime: toLocalTimeLabel(new Date()) })
            }
          >
            Use current date &amp; time
          </Button>
        </div>

        {/* Date and time sit side by side on a desktop and stack on a phone. */}
        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
          <Field label="Date">
            <input
              className={INPUT_CLASS}
              type="date"
              value={form.entryDate}
              onChange={(event) => set({ entryDate: event.target.value })}
            />
          </Field>
          <Field label="Time">
            <input
              className={INPUT_CLASS}
              type="time"
              value={form.entryTime}
              onChange={(event) => set({ entryTime: event.target.value })}
            />
          </Field>
          <Field label="Amount (USD)">
            <input
              className={INPUT_CLASS}
              inputMode="decimal"
              value={form.amount}
              placeholder="0.00"
              onChange={(event) => set({ amount: event.target.value })}
            />
          </Field>
          <Field label="Type">
            <select
              className={INPUT_CLASS}
              value={form.type}
              // Every option's value is an `HSA_TYPES` member, so the cast is exact.
              onChange={(event) => set({ type: event.target.value as HsaType })}
            >
              {HSA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Product or service">
          {/* Offers what was entered before and accepts anything new typed straight
              in. Fed by SELECT DISTINCT over the expenses, so the list cannot drift
              from what is actually stored. */}
          <IconSelect
            options={suggestionOptions(productServices)}
            value={form.productService}
            onChange={(productService) => set({ productService })}
            placeholder="Prescription, Eye exam…"
            ariaLabel="Product or service"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
          <Field label="Payee (store or doctor's office)">
            <IconSelect
              options={suggestionOptions(payees)}
              value={form.payee}
              onChange={(payee) => set({ payee })}
              placeholder="CVS, Dr. Lee…"
              ariaLabel="Payee"
            />
          </Field>
          <Field label="Date of service (optional)">
            <input
              className={INPUT_CLASS}
              type="date"
              value={form.serviceDate}
              onChange={(event) => set({ serviceDate: event.target.value })}
            />
          </Field>
          <Field label="Paid with">
            <select
              className={INPUT_CLASS}
              value={form.paidWith}
              onChange={(event) => set({ paidWith: event.target.value })}
            >
              <option value="">—</option>
              {paidWithOptions.map((name) => (
                <option key={name} value={name}>
                  {activeCards.includes(name) ? name : `${name} (no longer in the list)`}
                </option>
              ))}
            </select>
            {activeCards.length === 0 && (
              <span className="text-xs text-muted">
                No cards yet — add them under HSA Tracker → Cards.
              </span>
            )}
          </Field>
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isReimbursed}
              onChange={(event) => set({ isReimbursed: event.target.checked })}
            />
            Reimbursed
          </label>
        </div>

        <Field label="Note">
          <textarea
            className={`${INPUT_CLASS} min-h-20`}
            value={form.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </Field>

        <Field label="Receipt">
          <div className="flex flex-col gap-2">
            {/* The dropzone is also click-to-browse, so there is no separate "Attach"
                button beside it — two controls doing one job. Take photo stays, because
                opening the camera is a different act from choosing a file, and it is
                the one thing a phone cannot do by dragging. */}
            <MultiFileDropzone
              files={pendingFiles}
              onFilesChange={(next) => void handleFiles(next, "attach")}
              accept={RECEIPT_ACCEPT}
              label={
                hasStored
                  ? "Drag a replacement here, or click to browse"
                  : "Drag receipts here, or click to browse"
              }
              disabled={isBusy || isReading || !canAttachReceipt}
            />

            {/* Phone only — see the camera input below. Hidden by a wrapper rather than
                a `lg:hidden` on the Button: `Button` concatenates `className` after its
                own `inline-flex`, so a display override there is a specificity argument
                the wrapper avoids. */}
            <span className="max-lg:contents lg:hidden">
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy || isReading || !canAttachReceipt}
                title={canAttachReceipt ? undefined : "No receipt folder is set."}
                onClick={() => cameraInput.current?.click()}
              >
                {isReading ? "Reading…" : "Take photo"}
              </Button>
            </span>

            {/* `capture="environment"` asks for the rear camera directly. A desktop
                browser ignores `capture`, which is why the button above is phone-only.
                No `multiple`: a camera returns one shot. */}
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFiles([file], "camera");
                event.target.value = "";
              }}
            />

            {/* A thumbnail of a single chosen image, so a camera shot can be checked
                before saving. Not shown for a zip or a PDF: there is nothing to draw,
                and a stack of thumbnails would repeat the dropzone's own list. */}
            {receipt.kind === "new" && receipt.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a local object
              // URL with no known dimensions; next/image would need a loader for bytes
              // that never touch the network.
              <img
                src={receipt.previewUrl}
                alt=""
                className="h-24 w-24 rounded-md border border-line object-cover"
              />
            )}

            {/* What will happen on save, in one line. */}
            {receipt.kind === "new" ? (
              <span className="text-xs text-muted">
                {pendingFiles.length > 1
                  ? `${pendingFiles.length} files — zipped into one archive and saved when you press Save Expense.`
                  : `${receipt.upload.fileName} — saved when you press Save Expense.`}
              </span>
            ) : receipt.kind === "remove" ? (
              <span className="text-xs text-muted">
                The stored receipt and its file are deleted when you save.
              </span>
            ) : hasStored && expenseId !== undefined ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>◉ Attached:</span>
                <a
                  href={`/api/household/hsa/${expenseId}/receipt`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-brass underline"
                >
                  {existingReceiptName}
                </a>
                <Button size="sm" variant="danger" disabled={isBusy} onClick={() => setIsConfirmingRemove(true)}>
                  Remove receipt
                </Button>
              </span>
            ) : null}

            {isConfirmingRemove && (
              // An inline panel rather than a second Modal: two stacked dialogs would
              // each trap focus and share one z-index.
              <div className="panel-inset rounded-md bg-paper px-3 py-2">
                <p className="text-xs text-ink">
                  Saving will <strong>delete the file</strong> from the receipt folder. This
                  cannot be undone.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setIsConfirmingRemove(false)}>
                    Keep it
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      onReceipt({ kind: "remove" });
                      setPendingFiles([]);
                      setIsConfirmingRemove(false);
                    }}
                  >
                    Remove it
                  </Button>
                </div>
              </div>
            )}

            <span className="text-xs text-muted">
              {canAttachReceipt
                ? "Attached files are stored exactly as they are, up to 15 MB; several become one zip. Take photo shrinks the shot to fit. Either way it is renamed and filed under its year in the receipt folder."
                : "No receipt folder is set — an administrator can set one under Household → Configuration."}
            </span>
            {fileError && <span className="text-xs text-ink">{fileError}</span>}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
