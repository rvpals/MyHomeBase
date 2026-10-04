import { z } from "zod";
import { HSA_TYPES } from "./hsa-types";

/**
 * The largest receipt accepted, measured on the incoming file.
 *
 * The ceiling is a server action's 4 MB body (`serverActions.bodySizeLimit`), and
 * base64 inflates a file by a third on the way — so 3 MB of file is about 4.0 MB on
 * the wire, which is already at the edge. 2.9 MB leaves a little room for the rest of
 * the payload and is the practical maximum.
 *
 * It was 2.5 MB when every image was shrunk in the browser. An *attached* file is now
 * sent byte-for-byte (only the camera path shrinks), so this cap is what a scanned PDF
 * or a full-size photo actually has to fit inside.
 */
export const MAX_HSA_RECEIPT_BYTES = 2.9 * 1024 * 1024;

/**
 * What a receipt may be. SVG is excluded for the reason `IMAGE_UPLOAD_MIME_TYPES`
 * excludes it: the bytes are served back from this app's own origin, and an SVG can
 * carry script.
 */
export const HSA_RECEIPT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export type HsaReceiptMimeType = (typeof HSA_RECEIPT_MIME_TYPES)[number];

export const hsaReceiptUploadSchema = z.object({
  mimeType: z.enum(HSA_RECEIPT_MIME_TYPES, {
    message: "Attach a PNG, JPEG, WebP, GIF image or a PDF.",
  }),
  /** Base64 of the file, as read in the browser. */
  base64Data: z.string().min(1, "The file is empty."),
  /** The file's own name, kept so the receipt can be recognised later. */
  fileName: z.string().trim().min(1, "The file has no name.").max(200, "That file name is too long."),
});

export type HsaReceiptUploadInput = z.infer<typeof hsaReceiptUploadSchema>;

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-tripping catches 2026-02-31, which `Date.UTC` would roll into March.
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const dateSchema = z
  .string()
  .trim()
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

export const setHsaReceiptSchema = z.object({
  id: hsaExpenseIdSchema,
  receipt: hsaReceiptUploadSchema,
});
export type SetHsaReceiptInput = z.input<typeof setHsaReceiptSchema>;

export const hsaCardIdSchema = z.number().int().positive();

export const hsaCardNameSchema = z
  .string()
  .trim()
  .min(1, "A card needs a name.")
  .max(100, "Keep a card name under 100 characters.");
