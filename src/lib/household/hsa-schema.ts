import { z } from "zod";
import { HSA_TYPES } from "./hsa-types";

/**
 * The largest receipt accepted, measured on the incoming file.
 *
 * 15 MB, against a `bodySizeLimit` of 16 MB. The receipt travels as a **binary blob
 * in `FormData`**, not as a base64 string argument, which is what makes a number this
 * size possible at all:
 *
 * - base64 inflated every file by a third, so the old 2.9 MB was ~3.9 MB on the wire;
 * - worse, React charges **one array slot per character** of a string argument in a
 *   multi-argument server action call, with a ceiling near 1,000,001 — so the base64
 *   path would in practice have failed somewhere under 1 MB of file, with a framework
 *   error rather than this module's message. `next.config.ts` records the same lesson
 *   from the calendar importer.
 *
 * A blob is counted in neither way: the only budget left is the body size, and that
 * is a real one we set.
 */
export const MAX_HSA_RECEIPT_BYTES = 15 * 1024 * 1024;

/**
 * What a receipt may be. SVG is excluded for the reason `IMAGE_UPLOAD_MIME_TYPES`
 * excludes it: the bytes are served back from this app's own origin, and an SVG can
 * carry script.
 *
 * `application/zip` is what several files attached at once become — the browser packs
 * them into one archive so an expense still holds exactly one file. It is NOT offered
 * in the file picker: a zip is something this app produces, not something to upload.
 */
export const HSA_RECEIPT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/zip",
] as const;

export type HsaReceiptMimeType = (typeof HSA_RECEIPT_MIME_TYPES)[number];

/** What the picker offers. The zip is produced here, never chosen. */
export const HSA_RECEIPT_PICKABLE_MIME_TYPES = HSA_RECEIPT_MIME_TYPES.filter(
  (type) => type !== "application/zip",
);

/**
 * One receipt on its way in, as the use-case takes it.
 *
 * `data` is **bytes**, not base64: the upload arrives as a binary blob in `FormData`
 * (see `MAX_HSA_RECEIPT_BYTES` for why), so nothing is ever encoded as a string. The
 * action converts the blob; the use-case and the CLI both hand over a Buffer.
 *
 * Not a zod object, because `z.instanceof(Buffer)` buys nothing a type check does not
 * already give at this boundary — the action validates the parts that can lie (the
 * declared type, the size, the signature) explicitly.
 */
export interface HsaReceiptUploadInput {
  mimeType: HsaReceiptMimeType;
  data: Buffer;
  /** The file's own name — never a path. Kept so the receipt can be recognised later. */
  fileName: string;
}

/** Validates the parts of an upload that travel as text beside the blob. */
export const hsaReceiptMetaSchema = z.object({
  mimeType: z.enum(HSA_RECEIPT_MIME_TYPES, {
    message: "Attach a PNG, JPEG, WebP, GIF image or a PDF.",
  }),
  fileName: z.string().trim().min(1, "The file has no name.").max(200, "That file name is too long."),
});

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-tripping catches 2026-02-31, which `Date.UTC` would roll into March.
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Blank is reported separately from malformed: the editor's Date field now starts
// empty (an HSA receipt is usually entered after the fact, so a pre-filled today is
// wrong more often than right), which makes "you have not set one" the common case
// and "that is not a real date" the rare one. A single message would have greeted
// every first save with YYYY-MM-DD formatting advice.
const dateSchema = z
  .string()
  .trim()
  .min(1, "Pick the date of the expense — or use the current date & time button.")
  .refine(isRealIsoDate, "Enter a real date as YYYY-MM-DD.");

/** Optional: blank, or null, means not recorded. */
const serviceDateSchema = z
  .union([z.literal(""), z.null(), dateSchema])
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value));

/** `<input type="time">` submits HH:MM. Blank is allowed — an old receipt may have no time. */
const timeSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    "Enter the time as HH:MM.",
  )
  .default("");

/**
 * Dollars as typed ("12.50", "$1,200") into integer cents.
 *
 * Parsed here rather than in the form so the CLI and the web app accept the same
 * strings. Rounds to the cent, refuses zero and negatives, and refuses more than two
 * decimals — a third decimal means a typo, and silently rounding it would store an
 * amount the person didn't type.
 */
const amountSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const text = String(value).trim().replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in dollars, like 42.50." });
      return z.NEVER;
    }
    const cents = Math.round(Number(text) * 100);
    if (cents <= 0) {
      ctx.addIssue({ code: "custom", message: "The amount must be more than zero." });
      return z.NEVER;
    }
    return cents;
  });

export const hsaExpenseIdSchema = z.number().int().positive();

export const hsaExpenseIdsSchema = z.array(hsaExpenseIdSchema).min(1, "Select at least one expense.");

/** Creating or replacing an expense. The receipt is attached separately. */
export const hsaExpenseSchema = z.object({
  entryDate: dateSchema,
  entryTime: timeSchema,
  amount: amountSchema,
  productService: z.string().trim().min(1, "Enter the product or service.").max(200),
  type: z.enum(HSA_TYPES, { message: `Type must be one of: ${HSA_TYPES.join(", ")}.` }),
  payee: z.string().trim().min(1, "Enter the payee — the store or doctor's office.").max(200),
  serviceDate: serviceDateSchema,
  paidWith: z.string().trim().max(100).default(""),
  note: z.string().trim().default(""),
  isReimbursed: z.boolean().default(false),
});

export type HsaExpenseInput = z.input<typeof hsaExpenseSchema>;
/** What the repository writes: `amount` has become `amountCents`. */
export type HsaExpenseData = Omit<z.output<typeof hsaExpenseSchema>, "amount"> & {
  amountCents: number;
};

export const bulkDeleteHsaExpensesSchema = z.object({ ids: hsaExpenseIdsSchema });
export type BulkDeleteHsaExpensesInput = z.input<typeof bulkDeleteHsaExpensesSchema>;

export const bulkSetReimbursedSchema = z.object({
  ids: hsaExpenseIdsSchema,
  isReimbursed: z.boolean(),
});
export type BulkSetReimbursedInput = z.input<typeof bulkSetReimbursedSchema>;

/**
 * Attaching a receipt to an expense.
 *
 * The id is validated here; the receipt's own bytes are checked in the use-case,
 * which is where the size cap and the file-signature tests live.
 */
export interface SetHsaReceiptInput {
  id: number;
  receipt: HsaReceiptUploadInput;
}

export const hsaCardIdSchema = z.number().int().positive();

export const hsaCardNameSchema = z
  .string()
  .trim()
  .min(1, "A card needs a name.")
  .max(100, "Keep a card name under 100 characters.");
