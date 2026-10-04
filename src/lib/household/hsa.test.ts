import { describe, expect, it } from "vitest";
import {
  clearHsaReceipt,
  createHsaCard,
  createHsaExpense,
  deleteHsaCard,
  deleteHsaExpenses,
  getHsaExpense,
  getHsaReceipt,
  listHsaCards,
  listHsaExpenses,
  listHsaProductServices,
  renameHsaCard,
  setHsaCardActive,
  setHsaReceipt,
  setHsaReimbursed,
  updateHsaExpense,
  type HsaReceiptFiles,
} from "./hsa";
import type { HsaRepository } from "./hsa-ports";
import { MAX_HSA_RECEIPT_BYTES, type HsaExpenseData, type HsaReceiptUploadInput } from "./hsa-schema";
import type { HsaCard, HsaExpense } from "./hsa-types";
import type { FolderListing, ReceiptFileStore, ReceiptRootCheck } from "./receipt-store";

/** A hand-written in-memory repository — fakes over mocks, per ARCHITECTURE.md. */
class FakeHsaRepository implements HsaRepository {
  private nextId = 1;
  private nextCardId = 1;
  readonly expenses = new Map<number, HsaExpense>();
  readonly cards = new Map<number, HsaCard>();
  /** Makes the next `updateExpense` throw, to exercise the move-back path. */
  failNextUpdate = false;

  listExpenses(): HsaExpense[] {
    return [...this.expenses.values()].sort((a, b) =>
      `${b.entryDate} ${b.entryTime}`.localeCompare(`${a.entryDate} ${a.entryTime}`),
    );
  }

  getExpenseById(id: number): HsaExpense | undefined {
    return this.expenses.get(id);
  }

  createExpense(input: HsaExpenseData): HsaExpense {
    const id = this.nextId++;
    const expense: HsaExpense = {
      id,
      ...input,
      hasReceipt: false,
      receiptPath: "",
      receiptFileName: "",
      receiptMimeType: "",
      createdAt: "now",
      updatedAt: "now",
    };
    this.expenses.set(id, expense);
    return expense;
  }

  updateExpense(id: number, input: HsaExpenseData): HsaExpense | undefined {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error("database is locked");
    }
    const existing = this.expenses.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...input };
    this.expenses.set(id, updated);
    return updated;
  }

  deleteExpenses(ids: number[]): number {
    let removed = 0;
    for (const id of ids) if (this.expenses.delete(id)) removed++;
    return removed;
  }

  setReimbursed(ids: number[], isReimbursed: boolean): number {
    let changed = 0;
    for (const id of ids) {
      const expense = this.expenses.get(id);
      if (!expense) continue;
      this.expenses.set(id, { ...expense, isReimbursed });
      changed++;
    }
    return changed;
  }

  setReceipt(id: number, receipt: { path: string; mimeType: string; fileName: string }): void {
    const expense = this.expenses.get(id)!;
    this.expenses.set(id, {
      ...expense,
      hasReceipt: true,
      receiptPath: receipt.path,
      receiptFileName: receipt.fileName,
      receiptMimeType: receipt.mimeType,
    });
  }

  setReceiptPath(id: number, path: string): void {
    const expense = this.expenses.get(id)!;
    this.expenses.set(id, { ...expense, receiptPath: path });
  }

  clearReceipt(id: number): void {
    const expense = this.expenses.get(id);
    if (expense) {
      this.expenses.set(id, {
        ...expense,
        hasReceipt: false,
        receiptPath: "",
        receiptFileName: "",
        receiptMimeType: "",
      });
    }
  }

  listProductServices(): string[] {
    const seen = new Map<string, string>();
    for (const expense of this.expenses.values()) {
      const key = expense.productService.toLowerCase();
      if (!seen.has(key)) seen.set(key, expense.productService);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  listCards(): HsaCard[] {
    return [...this.cards.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getCardById(id: number): HsaCard | undefined {
    return this.cards.get(id);
  }

  createCard(name: string): HsaCard {
    this.assertFree(name);
    const card: HsaCard = { id: this.nextCardId++, name, isActive: true, createdAt: "now" };
    this.cards.set(card.id, card);
    return card;
  }

  renameCard(id: number, name: string): HsaCard | undefined {
    const card = this.cards.get(id);
    if (!card) return undefined;
    this.assertFree(name, id);
    const renamed = { ...card, name };
    this.cards.set(id, renamed);
    return renamed;
  }

  setCardActive(id: number, isActive: boolean): HsaCard | undefined {
    const card = this.cards.get(id);
    if (!card) return undefined;
    const updated = { ...card, isActive };
    this.cards.set(id, updated);
    return updated;
  }

  deleteCard(id: number): void {
    this.cards.delete(id);
  }

  private assertFree(name: string, exceptId?: number): void {
    for (const card of this.cards.values()) {
      if (card.name.toLowerCase() === name.toLowerCase() && card.id !== exceptId) {
        throw new Error(`A card named "${name}" already exists.`);
      }
    }
  }
}

/** An in-memory receipt folder: relative path -> bytes. */
class FakeReceiptFileStore implements ReceiptFileStore {
  readonly files = new Map<string, Buffer>();
  failRemove = false;
  failMove = false;

  async write(_root: string, relativePath: string, data: Buffer): Promise<void> {
    this.files.set(relativePath, data);
  }
  async read(_root: string, relativePath: string): Promise<Buffer | undefined> {
    return this.files.get(relativePath);
  }
  async exists(_root: string, relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }
  async move(_root: string, fromPath: string, toPath: string): Promise<void> {
    if (this.failMove) throw new Error("EACCES");
    const data = this.files.get(fromPath);
    if (!data) throw new Error("ENOENT");
    this.files.delete(fromPath);
    this.files.set(toPath, data);
  }
  async remove(_root: string, relativePath: string): Promise<void> {
    if (this.failRemove) throw new Error("EBUSY");
    this.files.delete(relativePath);
  }
  async checkRoot(): Promise<ReceiptRootCheck> {
    return { kind: "ok", path: "/receipts" };
  }
  async listFolders(): Promise<FolderListing> {
    return { path: "/", parent: null, folders: [] };
  }
}

function setup(root = "/receipts") {
  const repo = new FakeHsaRepository();
  const store = new FakeReceiptFileStore();
  const files: HsaReceiptFiles = { store, root };
  return { repo, store, files };
}

const VALID = {
  entryDate: "2026-10-03",
  entryTime: "14:30",
  amount: "42.50",
  productService: "Prescription",
  type: "Pharmacy" as const,
  payee: "CVS",
};

const b64 = (text: string | Buffer) => Buffer.from(text).toString("base64");

const upload = (over: Partial<HsaReceiptUploadInput> = {}): HsaReceiptUploadInput => ({
  mimeType: "image/jpeg",
  base64Data: b64("jpeg-bytes"),
  fileName: "IMG_0001.jpg",
  ...over,
});

describe("createHsaExpense", () => {
  it("stores the amount as integer cents and applies the defaults", () => {
    const { repo } = setup();
    const expense = createHsaExpense(repo, VALID);

    expect(expense.amountCents).toBe(4250);
    expect(expense.isReimbursed).toBe(false);
    expect(expense.serviceDate).toBeNull();
    expect(expense.paidWith).toBe("");
    expect(expense.note).toBe("");
  });

  it("accepts a typed dollar sign and thousands separator", () => {
    expect(createHsaExpense(setup().repo, { ...VALID, amount: "$1,200.5" }).amountCents).toBe(120050);
  });

  it("accepts a numeric amount", () => {
    expect(createHsaExpense(setup().repo, { ...VALID, amount: 19.99 }).amountCents).toBe(1999);
  });

  it("keeps an optional service date, and treats blank as not recorded", () => {
    const { repo } = setup();
    expect(createHsaExpense(repo, { ...VALID, serviceDate: "2026-09-20" }).serviceDate).toBe("2026-09-20");
    expect(createHsaExpense(repo, { ...VALID, serviceDate: "" }).serviceDate).toBeNull();
  });

  it("allows a blank time for a back-dated receipt", () => {
    expect(createHsaExpense(setup().repo, { ...VALID, entryTime: "" }).entryTime).toBe("");
  });

  it.each([
    ["zero", { amount: "0" }],
    ["negative", { amount: "-5" }],
    ["not a number", { amount: "abc" }],
    ["three decimals", { amount: "1.005" }],
    ["blank product", { productService: "  " }],
    ["blank payee", { payee: "" }],
    ["unknown type", { type: "Spa" as never }],
    ["impossible date", { entryDate: "2026-02-31" }],
    ["malformed date", { entryDate: "10/03/2026" }],
    ["bad time", { entryTime: "25:00" }],
    ["bad service date", { serviceDate: "yesterday" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => createHsaExpense(setup().repo, { ...VALID, ...patch })).toThrow();
  });
});

describe("setHsaReceipt", () => {
  it("files the receipt under its year with the generated name", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);

    const result = await setHsaReceipt(repo, files, { id, receipt: upload() });

    expect(result.path).toBe(`2026/2026-10-03_CVS_$42.50_${id}.jpg`);
    expect(store.files.has(result.path)).toBe(true);
    const expense = getHsaExpense(repo, id)!;
    expect(expense.hasReceipt).toBe(true);
    expect(expense.receiptPath).toBe(result.path);
    expect(expense.receiptFileName).toBe("IMG_0001.jpg");
  });

  it("files a back-dated expense under ITS year, not this one", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, { ...VALID, entryDate: "2024-12-31" });
    expect((await setHsaReceipt(repo, files, { id, receipt: upload() })).path.startsWith("2024/")).toBe(true);
  });

  it("is refused when no receipt folder is set, and stores nothing", async () => {
    const { repo, store, files } = setup("  ");
    const { id } = createHsaExpense(repo, VALID);
    await expect(setHsaReceipt(repo, files, { id, receipt: upload() })).rejects.toThrow("No receipt folder");
    expect(store.files.size).toBe(0);
    expect(getHsaExpense(repo, id)?.hasReceipt).toBe(false);
  });

  it("adds a suffix rather than overwrite a stray file of the same name", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    store.files.set(`2026/2026-10-03_CVS_$42.50_${id}.jpg`, Buffer.from("someone else's"));

    const result = await setHsaReceipt(repo, files, { id, receipt: upload() });

    expect(result.path).toBe(`2026/2026-10-03_CVS_$42.50_${id}-2.jpg`);
  });

  it("replacing a receipt overwrites it in place when the name is unchanged", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await setHsaReceipt(repo, files, { id, receipt: upload({ base64Data: b64("first") }) });
    const result = await setHsaReceipt(repo, files, { id, receipt: upload({ base64Data: b64("second") }) });

    expect(store.files.size).toBe(1);
    expect(store.files.get(result.path)?.toString()).toBe("second");
  });

  it("replacing with a different type deletes the old file", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const first = await setHsaReceipt(repo, files, { id, receipt: upload() });
    const second = await setHsaReceipt(repo, files, {
      id,
      receipt: { mimeType: "application/pdf", base64Data: b64("%PDF-1.4 x"), fileName: "bill.pdf" },
    });

    expect(second.path.endsWith(".pdf")).toBe(true);
    expect(store.files.has(first.path)).toBe(false);
    expect(store.files.size).toBe(1);
  });

  it("reports, rather than throws, an old file it could not delete", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const first = await setHsaReceipt(repo, files, { id, receipt: upload() });
    store.failRemove = true;
    const second = await setHsaReceipt(repo, files, {
      id,
      receipt: { mimeType: "image/png", base64Data: b64("png"), fileName: "r.png" },
    });
    expect(second.oldFileNotDeleted).toBe(first.path);
    expect(getHsaExpense(repo, id)?.receiptPath).toBe(second.path);
  });

  it("refuses a file that claims to be a PDF but is not", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await expect(
      setHsaReceipt(repo, files, {
        id,
        receipt: { mimeType: "application/pdf", base64Data: b64("<html>"), fileName: "x.pdf" },
      }),
    ).rejects.toThrow("not a PDF");
  });

  it("refuses a type outside the allowlist, such as SVG", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await expect(
      // Cast: the point is that the runtime schema refuses what the type would not allow.
      setHsaReceipt(repo, files, {
        id,
        receipt: { ...upload(), mimeType: "image/svg+xml" } as unknown as HsaReceiptUploadInput,
      }),
    ).rejects.toThrow();
  });

  it("refuses a file over the cap", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const big = Buffer.alloc(MAX_HSA_RECEIPT_BYTES + 1, 1);
    await expect(setHsaReceipt(repo, files, { id, receipt: upload({ base64Data: b64(big) }) })).rejects.toThrow(
      "too large",
    );
  });

  it("refuses an unknown expense", async () => {
    const { repo, files } = setup();
    await expect(setHsaReceipt(repo, files, { id: 7, receipt: upload() })).rejects.toThrow("No expense with id 7");
  });
});

describe("getHsaReceipt", () => {
  it("reads the bytes back from the folder with the stored name", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id, receipt: upload() });

    const receipt = await getHsaReceipt(repo, files, id);
    expect(receipt?.data.toString()).toBe("jpeg-bytes");
    expect(receipt?.mimeType).toBe("image/jpeg");
    expect(receipt?.fileName).toBe(path.split("/")[1]);
  });

  it("returns undefined when the file has gone missing from the folder", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id, receipt: upload() });
    store.files.delete(path);
    expect(await getHsaReceipt(repo, files, id)).toBeUndefined();
  });
});

describe("updateHsaExpense", () => {
  it("replaces the fields of an expense with no receipt", async () => {
    const { repo, files } = setup();
    const created = createHsaExpense(repo, VALID);
    const updated = await updateHsaExpense(repo, files, created.id, { ...VALID, amount: "10", isReimbursed: true });
    expect(updated.amountCents).toBe(1000);
    expect(updated.isReimbursed).toBe(true);
  });

  it("moves the receipt into the new year's folder when the date changes year", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path: before } = await setHsaReceipt(repo, files, { id, receipt: upload() });

    const updated = await updateHsaExpense(repo, files, id, { ...VALID, entryDate: "2025-12-30" });

    expect(updated.receiptPath).toBe(`2025/2025-12-30_CVS_$42.50_${id}.jpg`);
    expect(store.files.has(before)).toBe(false);
    expect(store.files.has(updated.receiptPath)).toBe(true);
  });

  it("renames the receipt when the payee or amount changes", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await setHsaReceipt(repo, files, { id, receipt: upload() });
    const updated = await updateHsaExpense(repo, files, id, { ...VALID, payee: "Walgreens", amount: "9" });
    expect(updated.receiptPath).toBe(`2026/2026-10-03_Walgreens_$9.00_${id}.jpg`);
  });

  it("leaves the file alone when nothing in its name changed", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id, receipt: upload() });
    const updated = await updateHsaExpense(repo, files, id, { ...VALID, note: "picked up" });
    expect(updated.receiptPath).toBe(path);
  });

  it("saves nothing when the file cannot be moved", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id, receipt: upload() });
    store.failMove = true;

    await expect(updateHsaExpense(repo, files, id, { ...VALID, entryDate: "2025-01-01" })).rejects.toThrow(
      "Nothing was saved",
    );
    expect(getHsaExpense(repo, id)?.entryDate).toBe("2026-10-03");
    expect(getHsaExpense(repo, id)?.receiptPath).toBe(path);
  });

  it("moves the file back when the database write fails", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id, receipt: upload() });
    repo.failNextUpdate = true;

    await expect(updateHsaExpense(repo, files, id, { ...VALID, entryDate: "2025-01-01" })).rejects.toThrow(
      "database is locked",
    );
    expect(store.files.has(path)).toBe(true);
    expect(store.files.size).toBe(1);
  });

  it("throws on an unknown id", async () => {
    const { repo, files } = setup();
    await expect(updateHsaExpense(repo, files, 99, VALID)).rejects.toThrow("No expense with id 99");
  });

  it("rejects invalid input without writing", async () => {
    const { repo, files } = setup();
    const created = createHsaExpense(repo, VALID);
    await expect(updateHsaExpense(repo, files, created.id, { ...VALID, amount: "0" })).rejects.toThrow();
    expect(getHsaExpense(repo, created.id)?.amountCents).toBe(4250);
  });
});

describe("listHsaExpenses / getHsaExpense", () => {
  it("lists newest first", () => {
    const { repo } = setup();
    createHsaExpense(repo, { ...VALID, entryDate: "2026-01-01" });
    createHsaExpense(repo, { ...VALID, entryDate: "2026-06-01" });
    expect(listHsaExpenses(repo).map((e) => e.entryDate)).toEqual(["2026-06-01", "2026-01-01"]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getHsaExpense(setup().repo, 5)).toBeUndefined();
  });
});

describe("deleteHsaExpenses", () => {
  it("deletes the rows and their receipt files, ignoring stale ids", async () => {
    const { repo, store, files } = setup();
    const a = createHsaExpense(repo, VALID);
    const b = createHsaExpense(repo, VALID);
    await setHsaReceipt(repo, files, { id: a.id, receipt: upload() });

    const result = await deleteHsaExpenses(repo, files, { ids: [a.id, b.id, 999] });

    expect(result).toEqual({ removed: 2, filesNotDeleted: [] });
    expect(store.files.size).toBe(0);
  });

  it("reports a file it could not delete instead of throwing", async () => {
    const { repo, store, files } = setup();
    const a = createHsaExpense(repo, VALID);
    const { path } = await setHsaReceipt(repo, files, { id: a.id, receipt: upload() });
    store.failRemove = true;

    const result = await deleteHsaExpenses(repo, files, { ids: [a.id] });

    expect(result).toEqual({ removed: 1, filesNotDeleted: [path] });
    expect(listHsaExpenses(repo)).toHaveLength(0);
  });

  it("refuses an empty selection", async () => {
    const { repo, files } = setup();
    await expect(deleteHsaExpenses(repo, files, { ids: [] })).rejects.toThrow();
  });
});

describe("clearHsaReceipt", () => {
  it("unlinks the receipt and deletes the file", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await setHsaReceipt(repo, files, { id, receipt: upload() });

    await clearHsaReceipt(repo, files, id);

    expect(getHsaExpense(repo, id)?.hasReceipt).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it("says the receipt is already unlinked when only the file delete fails", async () => {
    const { repo, store, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await setHsaReceipt(repo, files, { id, receipt: upload() });
    store.failRemove = true;

    await expect(clearHsaReceipt(repo, files, id)).rejects.toThrow("was removed from the expense");
    expect(getHsaExpense(repo, id)?.hasReceipt).toBe(false);
  });

  it("is a no-op for an expense with no receipt", async () => {
    const { repo, files } = setup();
    const { id } = createHsaExpense(repo, VALID);
    await expect(clearHsaReceipt(repo, files, id)).resolves.toBeUndefined();
  });
});

describe("setHsaReimbursed", () => {
  it("flips the flag across a selection", () => {
    const { repo } = setup();
    const a = createHsaExpense(repo, VALID);
    const b = createHsaExpense(repo, VALID);
    expect(setHsaReimbursed(repo, { ids: [a.id, b.id], isReimbursed: true })).toBe(2);
    expect(getHsaExpense(repo, a.id)?.isReimbursed).toBe(true);
    expect(setHsaReimbursed(repo, { ids: [a.id], isReimbursed: false })).toBe(1);
    expect(getHsaExpense(repo, a.id)?.isReimbursed).toBe(false);
  });

  it("refuses an empty selection", () => {
    expect(() => setHsaReimbursed(setup().repo, { ids: [], isReimbursed: true })).toThrow();
  });
});

describe("listHsaProductServices", () => {
  it("offers each product once, case-insensitively", () => {
    const { repo } = setup();
    createHsaExpense(repo, { ...VALID, productService: "Prescription" });
    createHsaExpense(repo, { ...VALID, productService: "prescription" });
    createHsaExpense(repo, { ...VALID, productService: "Eye exam" });
    expect(listHsaProductServices(repo)).toEqual(["Eye exam", "Prescription"]);
  });
});

describe("cards", () => {
  it("creates, trims and lists cards", () => {
    const { repo } = setup();
    createHsaCard(repo, "  Visa 1234 ");
    expect(listHsaCards(repo).map((c) => c.name)).toEqual(["Visa 1234"]);
    expect(listHsaCards(repo)[0].isActive).toBe(true);
  });

  it("refuses a blank name and a duplicate (any case)", () => {
    const { repo } = setup();
    createHsaCard(repo, "Visa");
    expect(() => createHsaCard(repo, "  ")).toThrow("needs a name");
    expect(() => createHsaCard(repo, "visa")).toThrow("already exists");
  });

  it("renames, deactivates and deletes", () => {
    const { repo } = setup();
    const card = createHsaCard(repo, "Visa");
    expect(renameHsaCard(repo, card.id, "HSA card").name).toBe("HSA card");
    expect(setHsaCardActive(repo, card.id, false).isActive).toBe(false);
    deleteHsaCard(repo, card.id);
    expect(listHsaCards(repo)).toHaveLength(0);
  });

  it("refuses to rename onto another card's name, but allows a case-only change of its own", () => {
    const { repo } = setup();
    const visa = createHsaCard(repo, "Visa");
    createHsaCard(repo, "Amex");
    expect(() => renameHsaCard(repo, visa.id, "AMEX")).toThrow("already exists");
    expect(renameHsaCard(repo, visa.id, "VISA").name).toBe("VISA");
  });

  it("throws on an unknown id", () => {
    const { repo } = setup();
    expect(() => renameHsaCard(repo, 9, "x")).toThrow("No card with id 9");
    expect(() => setHsaCardActive(repo, 9, true)).toThrow("No card with id 9");
  });

  it("deleting a card leaves expenses paid with it untouched", () => {
    const { repo } = setup();
    const card = createHsaCard(repo, "Visa");
    const expense = createHsaExpense(repo, { ...VALID, paidWith: card.name });
    deleteHsaCard(repo, card.id);
    expect(getHsaExpense(repo, expense.id)?.paidWith).toBe("Visa");
  });
});
