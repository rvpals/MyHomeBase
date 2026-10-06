import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  createHsaCard,
  createHsaExpense,
  deleteHsaCard,
  deleteHsaExpenses,
  getHsaExpense,
  listHsaCards,
  listHsaExpenses,
  getHouseholdSettings,
  setHsaReceipt,
  setHsaReceiptRoot,
  setHsaReimbursed,
  type HsaReceiptFiles,
  type HsaReceiptMimeType,
  type HsaType,
} from "@/lib/household";
import { formatCents } from "@/lib/shared/money";
import { toLocalTimeLabel, todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The HSA Tracker from the terminal — the same use-cases the web app calls.
 *
 *   hsa                                         list every expense, newest first
 *   hsa --show 3                                print one expense in full
 *   hsa --add "Prescription" --amount 42.50 --payee CVS --type Pharmacy
 *       optional: --date 2026-09-01 --time 14:30 --service-date 2026-08-28
 *                 --paid-with "Visa 1234" --note "…" --reimbursed yes
 *                 --receipt ./receipt.jpg
 *   hsa --reimburse 3,4                         mark those reimbursed
 *   hsa --unreimburse 3                         mark that one not reimbursed
 *   hsa --delete 3,4
 *   hsa --cards                                 list the Paid with pick list
 *   hsa --add-card "Visa 1234"
 *   hsa --delete-card 2
 *   hsa --receipt-root                          print the configured receipt folder
 *   hsa --set-receipt-root /volume1/HSA         set it (checked before it is saved)
 *
 * `--date` and `--time` default to now, as the web form does. The amount is dollars;
 * the schema turns it into cents and rejects zero, negatives and a third decimal.
 */

const RECEIPT_TYPES: Record<string, HsaReceiptMimeType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function parseIds(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id));
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

export async function hsaCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const repo = deps.hsaRepo;
  // The receipt folder, read per run exactly as the web app reads it per request.
  const files: HsaReceiptFiles = {
    store: deps.receiptFileStore,
    root: getHouseholdSettings(deps.moduleRepo, deps.moduleSettingsRepo).hsaReceiptRoot,
  };

  try {
    if (flags["set-receipt-root"] !== undefined) {
      const saved = await setHsaReceiptRoot(
        deps.moduleRepo,
        deps.moduleSettingsRepo,
        deps.receiptFileStore,
        flags["set-receipt-root"],
      );
      console.log(
        saved.hsaReceiptRoot === ""
          ? "The receipt folder is cleared."
          : `Receipts will be filed under ${saved.hsaReceiptRoot}.`,
      );
      return;
    }

    if (flags["receipt-root"] !== undefined) {
      console.log(files.root === "" ? "No receipt folder is set." : files.root);
      return;
    }

    if (flags["add-card"]) {
      const card = createHsaCard(repo, flags["add-card"]);
      console.log(`Added card "${card.name}" as #${card.id}.`);
      return;
    }

    if (flags["delete-card"]) {
      deleteHsaCard(repo, Number(flags["delete-card"]));
      console.log(`Deleted card ${flags["delete-card"]}.`);
      return;
    }

    if (flags.cards !== undefined) {
      const cards = listHsaCards(repo);
      if (cards.length === 0) {
        console.log("No cards yet.");
        return;
      }
      for (const card of cards) console.log(`#${card.id}\t${card.name}${card.isActive ? "" : "  (hidden)"}`);
      return;
    }

    if (flags.reimburse || flags.unreimburse) {
      const ids = parseIds(flags.reimburse || flags.unreimburse);
      const changed = setHsaReimbursed(repo, { ids, isReimbursed: Boolean(flags.reimburse) });
      console.log(`${changed} ${changed === 1 ? "expense" : "expenses"} updated.`);
      return;
    }

    if (flags.delete) {
      // Deletes the receipt files too, and names any it could not remove.
      const { removed, filesNotDeleted } = await deleteHsaExpenses(repo, files, {
        ids: parseIds(flags.delete),
      });
      console.log(`Deleted ${removed} ${removed === 1 ? "expense" : "expenses"}.`);
      if (filesNotDeleted.length > 0) {
        console.error(`Still in the receipt folder: ${filesNotDeleted.join(", ")}`);
        process.exitCode = 1;
      }
      return;
    }

    if (flags.show) {
      const expense = getHsaExpense(repo, Number(flags.show));
      if (!expense) return fail(`No expense with id ${flags.show}.`);
      console.log(`#${expense.id}  ${formatCents(expense.amountCents)}  ${expense.productService}`);
      console.log(`Recorded:    ${expense.entryDate} ${expense.entryTime}`.trimEnd());
      console.log(`Type:        ${expense.type}`);
      console.log(`Payee:       ${expense.payee}`);
      if (expense.serviceDate) console.log(`Service on:  ${expense.serviceDate}`);
      if (expense.paidWith) console.log(`Paid with:   ${expense.paidWith}`);
      console.log(`Reimbursed:  ${expense.isReimbursed ? "Yes" : "No"}`);
      console.log(`Receipt:     ${expense.hasReceipt ? expense.receiptPath : "none"}`);
      if (expense.note) console.log(`\nNote:\n${expense.note}`);
      return;
    }

    if (flags.add) {
      const expense = createHsaExpense(repo, {
        entryDate: flags.date ?? todayIsoLocal(),
        entryTime: flags.time ?? toLocalTimeLabel(new Date()),
        amount: flags.amount ?? "",
        productService: flags.add,
        // A string off argv; the schema rejects anything that is not a real type.
        type: (flags.type ?? "Other") as HsaType,
        payee: flags.payee ?? "",
        serviceDate: flags["service-date"] ?? "",
        paidWith: flags["paid-with"] ?? "",
        note: flags.note ?? "",
        isReimbursed: ["yes", "y", "true", "1"].includes((flags.reimbursed ?? "").toLowerCase()),
      });

      if (flags.receipt) {
        const mimeType = RECEIPT_TYPES[extname(flags.receipt).toLowerCase()];
        if (!mimeType) throw new Error("A receipt must be a PNG, JPEG, WebP, GIF or PDF file.");
        // Filed under its year in the receipt folder, and stored at full size: the
        // browser is what shrinks a phone photo, and a file named on the command line
        // is usually already the size it should be.
        const { path } = await setHsaReceipt(repo, files, {
          id: expense.id,
          receipt: {
            mimeType,
            // Bytes, not base64: the use-case takes a Buffer, and only the web
            // action ever deals in blobs and form fields.
            data: readFileSync(flags.receipt),
            fileName: basename(flags.receipt),
          },
        });
        console.log(`Receipt filed as ${path}.`);
      }
      console.log(`Added "${expense.productService}" (${formatCents(expense.amountCents)}) as #${expense.id}.`);
      return;
    }

    // Default: the list.
    const expenses = listHsaExpenses(repo);
    if (expenses.length === 0) {
      console.log("No HSA expenses yet.");
      return;
    }
    for (const expense of expenses) {
      console.log(
        `#${String(expense.id).padStart(3, " ")}  ${expense.entryDate}  ` +
          `${formatCents(expense.amountCents).padStart(10, " ")}  ` +
          `${expense.isReimbursed ? "reimbursed" : "OPEN      "}  ` +
          `${expense.hasReceipt ? "receipt" : "       "}  ` +
          `${expense.productService} — ${expense.payee} (${expense.type})`,
      );
    }
    console.log(`\n${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"}.`);
  } catch (error) {
    fail(error instanceof Error ? error.message : "That did not work.");
  }
}
