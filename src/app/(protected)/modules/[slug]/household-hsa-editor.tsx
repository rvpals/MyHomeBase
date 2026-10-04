"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { HSA_TYPES, type HsaType } from "@/lib/household/hsa-types";
import type { HsaReceiptUploadInput } from "@/lib/household/hsa-schema";
import { prepareReceiptFile, type ReceiptSource } from "./household-hsa-receipt-file";

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
  | { kind: "new"; upload: HsaReceiptUploadInput; previewUrl?: string };

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
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string>();
  const [isReading, setIsReading] = useState(false);
  // Removing a STORED receipt deletes the file from the folder on save, so it is
  // confirmed. Discarding a file chosen a moment ago deletes nothing and is not.
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  // A card that was deactivated or deleted since this expense was entered must still
  // show as the selected value, or opening the editor would silently blank it on save.
  const paidWithOptions =
    form.paidWith && !activeCards.includes(form.paidWith)
      ? [form.paidWith, ...activeCards]
      : activeCards;

  async function handleFile(file: File, source: ReceiptSource) {
    setFileError(undefined);
    setIsReading(true);
    try {
      const upload = await prepareReceiptFile(file, source);
      onReceipt({
        kind: "new",
        upload,
        previewUrl: upload.mimeType.startsWith("image/")
          ? `data:${upload.mimeType};base64,${upload.base64Data}`
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
          {/* A datalist, not a select: it offers what was entered before but accepts a
              new one typed straight in. Fed by SELECT DISTINCT, so it cannot drift
              from what is stored. */}
          <input
            className={INPUT_CLASS}
            list="household-hsa-products"
            value={form.productService}
            placeholder="Prescription, Eye exam…"
            onChange={(event) => set({ productService: event.target.value })}
          />
          <datalist id="household-hsa-products">
            {productServices.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
          <Field label="Payee (store or doctor's office)">
            <input
              className={INPUT_CLASS}
              value={form.payee}
              onChange={(event) => set({ payee: event.target.value })}
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
          <div className="flex items-start gap-3 max-lg:flex-col">
            {receipt.kind === "new" && receipt.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a local data URL
              // with no known dimensions; next/image would need a loader for bytes that
              // never touch the network.
              <img
                src={receipt.previewUrl}
                alt=""
                className="h-24 w-24 rounded-md border border-line object-cover"
              />
            )}
            <div className="flex flex-col gap-1">
              {/* Two inputs, because one cannot be both. This one has no `capture`,
                  so a phone offers Take Photo, Photo Library and Files in one sheet and
                  a desktop opens an ordinary file dialog. It is the only one that
                  accepts a PDF. */}
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file, "attach");
                  // Cleared so choosing the same file twice fires `change` again.
                  event.target.value = "";
                }}
              />
              {/* `capture="environment"` asks for the rear camera directly, skipping
                  that sheet — the one-tap path for the common case of photographing a
                  receipt you are holding. A desktop browser ignores `capture` and would
                  show a plain file dialog, which is why the button it drives is hidden
                  above 1024px: two buttons doing the same thing there would be noise.
                  No PDF in `accept`: a camera cannot produce one. */}
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file, "camera");
                  event.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                {/* Phone only — see the camera input above. Hidden by a wrapper rather
                    than a `lg:hidden` on the Button: `Button` concatenates `className`
                    after its own `inline-flex`, so a display override there is a
                    specificity argument the wrapper simply avoids. A `max-lg:` variant
                    rather than a `useIsCompact()` read, per design.md: same control,
                    restyled away, so the desktop layout provably cannot regress. */}
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
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy || isReading || !canAttachReceipt}
                  title={canAttachReceipt ? undefined : "No receipt folder is set."}
                  onClick={() => fileInput.current?.click()}
                >
                  {isReading
                    ? "Reading…"
                    : receipt.kind === "new" || hasStored
                      ? "Replace receipt"
                      : "Attach receipt"}
                </Button>
                {(receipt.kind === "new" || hasStored) && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={isBusy}
                    // Discarding a held file falls back to whatever was stored (or to
                    // nothing, on a new expense) and deletes nothing, so it needs no
                    // confirmation; removing a stored receipt deletes the file, so it does.
                    onClick={() =>
                      receipt.kind === "new" ? onReceipt({ kind: "keep" }) : setIsConfirmingRemove(true)
                    }
                  >
                    {receipt.kind === "new" ? "Discard new file" : "Remove receipt"}
                  </Button>
                )}
              </div>
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
                        setIsConfirmingRemove(false);
                      }}
                    >
                      Remove it
                    </Button>
                  </div>
                </div>
              )}
              {receipt.kind === "new" && (
                <span className="text-xs text-muted">
                  {receipt.upload.fileName} — saved when you press Save Expense.
                </span>
              )}
              {receipt.kind === "keep" && hasStored && expenseId !== undefined && (
                <a
                  href={`/api/household/hsa/${expenseId}/receipt`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-brass underline"
                >
                  {existingReceiptName}
                </a>
              )}
              {receipt.kind === "remove" && (
                <span className="text-xs text-muted">
                  The stored receipt and its file are deleted when you save.
                </span>
              )}
              <span className="text-xs text-muted">
                {canAttachReceipt
                  ? "Take photo opens the camera and shrinks the shot to fit. Attach sends the file exactly as it is, up to 2.9 MB. Either way it is renamed and filed under its year in the receipt folder."
                  : "No receipt folder is set — an administrator can set one under Household → Configuration."}
              </span>
              {fileError && <span className="text-xs text-ink">{fileError}</span>}
            </div>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
