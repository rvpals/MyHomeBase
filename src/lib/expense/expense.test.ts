import { describe, expect, it } from "vitest";
import {
  bulkEditTransactions,
  clearAccountImage,
  clearCategoryIcon,
  countUnprocessed,
  createAccount,
  createRule,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteTransactions,
  listCategories,
  listTransactions,
  getAccountImage,
  getCategoryIcon,
  previewPatternMatches,
  resetProcessedFlags,
  applyRuleToExistingTransactions,
  runCleanupBatch,
  setAccountImage,
  setCategoryIcon,
  setVendorIcon,
  autoPopulateVendorIcon,
  clearVendorIcon,
  deleteVendor,
  getVendorIcon,
  listVendors,
  totalsByCategory,
  updateRule,
  updateTransaction,
  upsertCategory,
  upsertVendor,
} from "./expense";
import { MAX_CARD_IMAGE_BYTES, MAX_CATEGORY_ICON_BYTES, MAX_VENDOR_ICON_BYTES } from "./schema";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import type {
  AccountWriteData,
  CategoryWriteData,
  PostImportRuleWriteData,
  TransactionWriteData,
  VendorWriteData,
} from "./schema";
import type {
  CardImage,
  CategoryIcon,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
  ExpenseVendor,
  PostImportRule,
  VendorIcon,
} from "./types";

// Hand-written in-memory fake implementing the port.
function fakeRepo(): ExpenseRepository {
  let accounts: CreditCardAccount[] = [];
  let categories: ExpenseCategory[] = [];
  let vendors: ExpenseVendor[] = [];
  let transactions: ExpenseTransaction[] = [];
  let rules: PostImportRule[] = [];
  const images = new Map<number, CardImage>();
  const categoryIcons = new Map<string, CategoryIcon>();
  const vendorIcons = new Map<string, VendorIcon>();
  let nextAccountId = 1;
  let nextTransactionId = 1;
  let nextRuleId = 1;
  const now = "2026-08-01T00:00:00.000Z";

  function matchesFilter(transaction: ExpenseTransaction, filter?: TransactionFilter): boolean {
    if (!filter) return true;
    if (filter.accountId !== undefined && transaction.transactionAccountId !== filter.accountId) return false;
    if (filter.categoryName !== undefined && transaction.categoryName !== filter.categoryName) return false;
    if (filter.status !== undefined && transaction.status !== filter.status) return false;
    if (filter.fromDate !== undefined && transaction.transactionDate < filter.fromDate) return false;
    if (filter.toDate !== undefined && transaction.transactionDate > filter.toDate) return false;
    return true;
  }

  return {
    listAccounts: () => [...accounts],
    getAccountById: (id) => accounts.find((account) => account.id === id),
    createAccount(input: AccountWriteData) {
      const created: CreditCardAccount = {
        id: nextAccountId++,
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      accounts.push(created);
      return created;
    },
    updateAccount(id, input) {
      accounts = accounts.map((account) => (account.id === id ? { ...account, ...input } : account));
      return accounts.find((account) => account.id === id)!;
    },
    deleteAccount(id) {
      accounts = accounts.filter((account) => account.id !== id);
    },
    countTransactionsForAccount: (id) =>
      transactions.filter((transaction) => transaction.transactionAccountId === id).length,
    getAccountImage: (id) => images.get(id),
    setAccountImage(id, image) {
      if (image) images.set(id, image);
      else images.delete(id);
      accounts = accounts.map((account) =>
        account.id === id ? { ...account, imageMimeType: image?.mimeType } : account,
      );
    },

    listCategories: () => [...categories],
    getCategoryByName: (name) => categories.find((category) => category.name === name),
    upsertCategory(input: CategoryWriteData) {
      const existing = categories.find((category) => category.name === input.name);
      if (existing) {
        existing.description = input.description;
        return existing;
      }
      const created: ExpenseCategory = { ...input, createdAt: now, updatedAt: now };
      categories.push(created);
      return created;
    },
    deleteCategory(name) {
      categories = categories.filter((category) => category.name !== name);
      transactions = transactions.map((transaction) =>
        transaction.categoryName === name ? { ...transaction, categoryName: "" } : transaction,
      );
    },
    registerCategoriesIfMissing(names) {
      for (const name of names) {
        if (name.trim() !== "" && !categories.some((category) => category.name === name)) {
          categories.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
    getCategoryIcon: (name) => categoryIcons.get(name),
    setCategoryIcon(name, icon) {
      if (icon) categoryIcons.set(name, icon);
      else categoryIcons.delete(name);
      categories = categories.map((category) =>
        category.name === name ? { ...category, iconMimeType: icon?.mimeType } : category,
      );
    },

    // Vendors. Matched case-insensitively, mirroring the NOCASE index the real
    // repository relies on — a fake that compared exactly would let a
    // case-collision bug pass here and fail against SQLite.
    listVendors: () => [...vendors],
    getVendorByName: (name) =>
      vendors.find((vendor) => vendor.name.toUpperCase() === name.toUpperCase()),
    upsertVendor(input: VendorWriteData) {
      const existing = vendors.find(
        (vendor) => vendor.name.toUpperCase() === input.name.toUpperCase(),
      );
      if (existing) {
        existing.description = input.description;
        return existing;
      }
      const created: ExpenseVendor = { ...input, createdAt: now, updatedAt: now };
      vendors.push(created);
      return created;
    },
    deleteVendor(name) {
      // Deliberately leaves `transactions` alone — see deleteVendor's contract.
      vendors = vendors.filter((vendor) => vendor.name.toUpperCase() !== name.toUpperCase());
      vendorIcons.delete(name.toUpperCase());
    },
    registerVendorsIfMissing(names) {
      for (const name of names) {
        if (
          name.trim() !== "" &&
          !vendors.some((vendor) => vendor.name.toUpperCase() === name.toUpperCase())
        ) {
          vendors.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
    getVendorIcon: (name) => vendorIcons.get(name.toUpperCase()),
    setVendorIcon(name, icon) {
      if (icon) vendorIcons.set(name.toUpperCase(), icon);
      else vendorIcons.delete(name.toUpperCase());
      vendors = vendors.map((vendor) =>
        vendor.name.toUpperCase() === name.toUpperCase()
          ? { ...vendor, iconMimeType: icon?.mimeType }
          : vendor,
      );
    },

    listTransactions: (filter) => transactions.filter((t) => matchesFilter(t, filter)),
    getTransactionById: (id) => transactions.find((transaction) => transaction.id === id),
    createTransaction(input: TransactionWriteData, createdByUserId) {
      const created: ExpenseTransaction = {
        id: nextTransactionId++,
        ...input,
        createdByUserId,
        createdAt: now,
        updatedAt: now,
      };
      transactions.push(created);
      return created;
    },
    updateTransaction(id, input) {
      transactions = transactions.map((transaction) =>
        transaction.id === id ? { ...transaction, ...input } : transaction,
      );
      return transactions.find((transaction) => transaction.id === id)!;
    },
    deleteTransaction(id) {
      transactions = transactions.filter((transaction) => transaction.id !== id);
    },
    deleteTransactions(ids) {
      const before = transactions.length;
      transactions = transactions.filter((transaction) => !ids.includes(transaction.id));
      return before - transactions.length;
    },
    bulkUpdateTransactions(ids, changes) {
      let changed = 0;
      transactions = transactions.map((transaction) => {
        if (!ids.includes(transaction.id)) return transaction;
        changed += 1;
        // Only the named fields are written; zod has already stripped the rest.
        return { ...transaction, ...changes };
      });
      return changed;
    },
    transactionExists: (input) =>
      transactions.some(
        (transaction) =>
          transaction.transactionAccountId === input.transactionAccountId &&
          transaction.transactionDate === input.transactionDate &&
          transaction.transactionDescription === input.transactionDescription &&
          transaction.amountCents === input.amountCents,
      ),
    listUnprocessed: (limit) =>
      transactions.filter((transaction) => !transaction.processed).slice(0, limit),
    countUnprocessed: () => transactions.filter((transaction) => !transaction.processed).length,
    applyProcessingResult(id, assignments) {
      transactions = transactions.map((transaction) =>
        transaction.id === id
          ? ({ ...transaction, ...assignments, processed: true } as ExpenseTransaction)
          : transaction,
      );
    },
    resetProcessedFlags() {
      const count = transactions.length;
      transactions = transactions.map((transaction) => ({ ...transaction, processed: false }));
      return count;
    },
    forceApplyRuleAssignments(updates) {
      let changed = 0;
      for (const update of updates) {
        if (Object.keys(update.assignments).length === 0) continue;
        changed += 1;
        transactions = transactions.map((transaction) =>
          transaction.id === update.id
            ? ({ ...transaction, ...update.assignments } as ExpenseTransaction)
            : transaction,
        );
      }
      return changed;
    },

    listRules: () => [...rules].sort((a, b) => (a.priority === b.priority ? a.id - b.id : a.priority - b.priority)),
    getRuleById: (id) => rules.find((rule) => rule.id === id),
    createRule(input: PostImportRuleWriteData) {
      const id = nextRuleId++;
      const created: PostImportRule = {
        id,
        name: input.name,
        description: input.description,
        pattern: input.pattern,
        priority: input.priority,
        isEnabled: input.isEnabled,
        actions: input.actions.map((action, index) => ({
          id: index + 1,
          ruleId: id,
          fieldName: action.fieldName,
          fieldValue: action.fieldValue,
          sortOrder: index,
        })),
        createdAt: now,
        updatedAt: now,
      };
      rules.push(created);
      return created;
    },
    updateRule(id, input) {
      rules = rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              name: input.name,
              description: input.description,
              pattern: input.pattern,
              priority: input.priority,
              isEnabled: input.isEnabled,
              actions: input.actions.map((action, index) => ({
                id: index + 1,
                ruleId: id,
                fieldName: action.fieldName,
                fieldValue: action.fieldValue,
                sortOrder: index,
              })),
            }
          : rule,
      );
      return rules.find((rule) => rule.id === id)!;
    },
    deleteRule(id) {
      rules = rules.filter((rule) => rule.id !== id);
    },

    totalsByCategory(filter): CategoryTotal[] {
      const totals = new Map<string, CategoryTotal>();
      for (const transaction of transactions.filter((t) => matchesFilter(t, filter))) {
        const entry = totals.get(transaction.categoryName) ?? {
          categoryName: transaction.categoryName,
          totalCents: 0,
          transactionCount: 0,
        };
        entry.totalCents += transaction.amountCents;
        entry.transactionCount += 1;
        totals.set(transaction.categoryName, entry);
      }
      return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents);
    },
  };
}

function seedAccount(repo: ExpenseRepository) {
  return createAccount(repo, { name: "Visa", creditLineCents: 500000 });
}

describe("createTransaction", () => {
  it("records a transaction against an existing account", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);

    const created = createTransaction(
      repo,
      { transactionDate: "2026-07-15", transactionAccountId: account.id, amountCents: 2033 },
      7,
    );

    expect(created.amountCents).toBe(2033);
    expect(created.status).toBe("new"); // default
    expect(created.categoryName).toBe(""); // uncategorised by default
    expect(created.createdByUserId).toBe(7);
  });

  it("auto-registers a category named on the transaction", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);

    createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        amountCents: 1000,
        categoryName: "groceries",
      },
      1,
    );

    expect(listCategories(repo).map((category) => category.name)).toContain("groceries");
  });

  it("accepts a negative amount for a refund", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const refund = createTransaction(
      repo,
      { transactionDate: "2026-07-16", transactionAccountId: account.id, amountCents: -4500 },
      1,
    );
    expect(refund.amountCents).toBe(-4500);
  });

  it("rejects a transaction for an unknown account", () => {
    const repo = fakeRepo();
    expect(() =>
      createTransaction(
        repo,
        { transactionDate: "2026-07-15", transactionAccountId: 999, amountCents: 100 },
        1,
      ),
    ).toThrow(/No credit-card account/);
  });

  it("rejects a badly formatted date", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    expect(() =>
      createTransaction(
        repo,
        { transactionDate: "07/15/2026", transactionAccountId: account.id, amountCents: 100 },
        1,
      ),
    ).toThrow();
  });
});

describe("deleteAccount", () => {
  it("refuses while transactions still reference the account", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    createTransaction(
      repo,
      { transactionDate: "2026-07-15", transactionAccountId: account.id, amountCents: 100 },
      1,
    );

    expect(() => deleteAccount(repo, account.id)).toThrow(/still has 1 transaction/);
  });

  it("deletes an account with no transactions", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    deleteAccount(repo, account.id);
    expect(repo.listAccounts()).toHaveLength(0);
  });
});

describe("card images", () => {
  const tinyPngBase64 = Buffer.from("fake png bytes").toString("base64");

  it("stores an image and records its mime type on the account", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);

    setAccountImage(repo, account.id, { mimeType: "image/png", base64Data: tinyPngBase64 });

    expect(getAccountImage(repo, account.id)?.mimeType).toBe("image/png");
    expect(repo.getAccountById(account.id)?.imageMimeType).toBe("image/png");
  });

  it("clears the image again", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    setAccountImage(repo, account.id, { mimeType: "image/png", base64Data: tinyPngBase64 });

    clearAccountImage(repo, account.id);

    expect(getAccountImage(repo, account.id)).toBeUndefined();
    expect(repo.getAccountById(account.id)?.imageMimeType).toBeUndefined();
  });

  it("rejects a disallowed type, including SVG", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    expect(() =>
      setAccountImage(repo, account.id, {
        mimeType: "image/svg+xml" as never,
        base64Data: tinyPngBase64,
      }),
    ).toThrow();
  });

  it("rejects an image over the size cap", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const tooBig = Buffer.alloc(MAX_CARD_IMAGE_BYTES + 1).toString("base64");

    expect(() =>
      setAccountImage(repo, account.id, { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/);
  });

  it("rejects an image for an unknown account", () => {
    const repo = fakeRepo();
    expect(() =>
      setAccountImage(repo, 999, { mimeType: "image/png", base64Data: tinyPngBase64 }),
    ).toThrow(/No credit-card account/);
  });
});

describe("category icons", () => {
  const tinyPngBase64 = Buffer.from("fake png bytes").toString("base64");

  it("stores an icon and records its mime type on the category", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "groceries" });

    setCategoryIcon(repo, "groceries", { mimeType: "image/png", base64Data: tinyPngBase64 });

    expect(getCategoryIcon(repo, "groceries")?.mimeType).toBe("image/png");
    expect(repo.getCategoryByName("groceries")?.iconMimeType).toBe("image/png");
  });

  it("clears the icon again", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "groceries" });
    setCategoryIcon(repo, "groceries", { mimeType: "image/png", base64Data: tinyPngBase64 });

    clearCategoryIcon(repo, "groceries");

    expect(getCategoryIcon(repo, "groceries")).toBeUndefined();
    expect(repo.getCategoryByName("groceries")?.iconMimeType).toBeUndefined();
  });

  it("rejects a disallowed type, including SVG", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "groceries" });
    expect(() =>
      setCategoryIcon(repo, "groceries", {
        mimeType: "image/svg+xml" as never,
        base64Data: tinyPngBase64,
      }),
    ).toThrow();
  });

  it("rejects an icon over the size cap", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "groceries" });
    const tooBig = Buffer.alloc(MAX_CATEGORY_ICON_BYTES + 1).toString("base64");

    expect(() =>
      setCategoryIcon(repo, "groceries", { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/);
  });

  it("caps icons tighter than card art", () => {
    const repo = fakeRepo();
    upsertCategory(repo, { name: "groceries" });
    // Comfortably inside the card cap, over the icon cap — proves the two limits
    // are actually distinct rather than both reading the same constant.
    const cardSized = Buffer.alloc(MAX_CATEGORY_ICON_BYTES + 1024).toString("base64");
    expect(MAX_CATEGORY_ICON_BYTES).toBeLessThan(MAX_CARD_IMAGE_BYTES);

    expect(() =>
      setCategoryIcon(repo, "groceries", { mimeType: "image/png", base64Data: cardSized }),
    ).toThrow(/too large/);
  });

  it("refuses an icon for a category that doesn't exist", () => {
    const repo = fakeRepo();
    expect(() =>
      setCategoryIcon(repo, "nope", { mimeType: "image/png", base64Data: tinyPngBase64 }),
    ).toThrow(/No category named/);
    expect(() => clearCategoryIcon(repo, "nope")).toThrow(/No category named/);
  });
});

describe("deleteCategory", () => {
  it("clears the category from transactions rather than deleting them", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const transaction = createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        amountCents: 100,
        categoryName: "dining",
      },
      1,
    );

    deleteCategory(repo, "dining");

    expect(listTransactions(repo)).toHaveLength(1);
    expect(repo.getTransactionById(transaction.id)?.categoryName).toBe("");
  });
});

describe("runCleanupBatch", () => {
  function setup() {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const add = (transactionDescription: string) =>
      createTransaction(
        repo,
        {
          transactionDate: "2026-07-15",
          transactionAccountId: account.id,
          transactionDescription,
          amountCents: 2033,
        },
        1,
      );
    add("SQ *TGI FRIDAYS #221");
    add("LOCAL BAKERY");
    return { repo, account };
  }

  const tgiRule = {
    name: "TGI Friday's",
    pattern: "%TGI%",
    actions: [
      { fieldName: "vendor" as const, fieldValue: "TGI Friday" },
      { fieldName: "categoryName" as const, fieldValue: "Restaurant" },
    ],
  };

  it("sets every field the matching rule specifies", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);

    const result = runCleanupBatch(repo);

    expect(result.processedCount).toBe(2);
    expect(result.changedCount).toBe(1);
    const tgi = listTransactions(repo).find((t) => t.transactionDescription.includes("TGI"));
    expect(tgi).toMatchObject({ vendor: "TGI Friday", categoryName: "Restaurant" });
  });

  it("marks every row processed, including ones no rule matched", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);

    runCleanupBatch(repo);

    expect(listTransactions(repo).every((t) => t.processed)).toBe(true);
    expect(countUnprocessed(repo)).toBe(0);
  });

  it("reports each row in the log, naming the rule and what it changed", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);

    const { entries } = runCleanupBatch(repo);

    const tgiEntry = entries.find((entry) => entry.description.includes("TGI"));
    expect(tgiEntry?.pattern).toBe("%TGI%");
    expect(tgiEntry?.ruleName).toBe("TGI Friday's");
    expect(tgiEntry?.changes).toEqual([
      { fieldName: "vendor", value: "TGI Friday" },
      { fieldName: "categoryName", value: "Restaurant" },
    ]);

    const bakeryEntry = entries.find((entry) => entry.description === "LOCAL BAKERY");
    expect(bakeryEntry?.pattern).toBeUndefined();
    expect(bakeryEntry?.ruleName).toBeUndefined();
    expect(bakeryEntry?.changes).toEqual([]);
  });

  it("works through the queue in batches, reporting what is left", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);

    const first = runCleanupBatch(repo, 1);
    expect(first.processedCount).toBe(1);
    expect(first.remainingCount).toBe(1);

    const second = runCleanupBatch(repo, 1);
    expect(second.processedCount).toBe(1);
    expect(second.remainingCount).toBe(0);

    const third = runCleanupBatch(repo, 1);
    expect(third.processedCount).toBe(0); // queue empty, so the client loop stops
  });

  it("is a no-op on a second run, because the queue is empty", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);

    runCleanupBatch(repo);
    const second = runCleanupBatch(repo);

    expect(second.processedCount).toBe(0);
    expect(second.changedCount).toBe(0);
  });

  it("never overwrites a value entered by hand", () => {
    const { repo, account } = setup();
    const manual = createTransaction(
      repo,
      {
        transactionDate: "2026-07-16",
        transactionAccountId: account.id,
        transactionDescription: "SQ *TGI FRIDAYS #999",
        amountCents: 100,
        vendor: "My Own Vendor",
      },
      1,
    );
    createRule(repo, tgiRule);

    runCleanupBatch(repo);

    const saved = repo.getTransactionById(manual.id);
    expect(saved?.vendor).toBe("My Own Vendor");
    expect(saved?.categoryName).toBe("Restaurant"); // the free field is still filled
  });

  it("registers a category a rule introduces", () => {
    const { repo } = setup();
    createRule(repo, tgiRule);
    runCleanupBatch(repo);
    expect(listCategories(repo).map((category) => category.name)).toContain("Restaurant");
  });

  it("rejects a non-positive batch size", () => {
    expect(() => runCleanupBatch(fakeRepo(), 0)).toThrow();
  });
});

describe("createRule validation", () => {
  it("keeps the name and description it was given", () => {
    const repo = fakeRepo();
    const created = createRule(repo, {
      name: "TGI Friday's",
      description: "The card prints this restaurant under three different names.",
      pattern: "%TGI%",
      actions: [{ fieldName: "vendor", fieldValue: "TGI Friday" }],
    });

    expect(created.name).toBe("TGI Friday's");
    expect(created.description).toBe("The card prints this restaurant under three different names.");
  });

  it("defaults a missing description to blank", () => {
    const repo = fakeRepo();
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "categoryName", fieldValue: "online-purchase" }],
    });

    expect(created.description).toBe("");
  });

  it("rejects a rule with no name", () => {
    const repo = fakeRepo();

    expect(() =>
      createRule(repo, {
        name: "   ",
        pattern: "AMAZON%",
        actions: [{ fieldName: "categoryName", fieldValue: "online-purchase" }],
      }),
    ).toThrow(/name is required/i);
  });
});

describe("resetProcessedFlags", () => {
  it("re-queues everything so a new rule can reach older rows", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        transactionDescription: "SQ *TGI FRIDAYS",
        amountCents: 100,
      },
      1,
    );
    runCleanupBatch(repo);
    expect(countUnprocessed(repo)).toBe(0);

    createRule(repo, {
      name: "TGI Friday's",
      pattern: "%TGI%",
      actions: [{ fieldName: "vendor", fieldValue: "TGI Friday" }],
    });
    resetProcessedFlags(repo);
    expect(countUnprocessed(repo)).toBe(1);

    runCleanupBatch(repo);
    expect(listTransactions(repo)[0].vendor).toBe("TGI Friday");
  });
});

describe("previewPatternMatches", () => {
  it("counts which existing descriptions a pattern would match", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    for (const description of ["AMAZON MKTPL*1", "AMAZON.COM*2", "LOCAL BAKERY"]) {
      createTransaction(
        repo,
        {
          transactionDate: "2026-07-15",
          transactionAccountId: account.id,
          transactionDescription: description,
          amountCents: 100,
        },
        1,
      );
    }

    const preview = previewPatternMatches(repo, "AMAZON%");

    expect(preview.matchCount).toBe(2);
    expect(preview.samples).toHaveLength(2);
  });
});

describe("totalsByCategory", () => {
  it("sums spend per category, largest first", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const add = (categoryName: string, amountCents: number) =>
      createTransaction(
        repo,
        { transactionDate: "2026-07-15", transactionAccountId: account.id, amountCents, categoryName },
        1,
      );
    add("groceries", 5000);
    add("groceries", 2500);
    add("dining", 3000);

    const totals = totalsByCategory(repo);

    expect(totals[0]).toMatchObject({ categoryName: "groceries", totalCents: 7500, transactionCount: 2 });
    expect(totals[1]).toMatchObject({ categoryName: "dining", totalCents: 3000 });
  });
});

describe("updateTransaction", () => {
  it("updates fields and keeps validation", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const created = createTransaction(
      repo,
      { transactionDate: "2026-07-15", transactionAccountId: account.id, amountCents: 100 },
      1,
    );

    const updated = updateTransaction(repo, created.id, {
      transactionDate: "2026-07-15",
      transactionAccountId: account.id,
      amountCents: 250,
      note: "split with Ting",
      status: "reconciled",
    });

    expect(updated).toMatchObject({ amountCents: 250, note: "split with Ting", status: "reconciled" });
  });

  it("rejects an unknown transaction", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    expect(() =>
      updateTransaction(repo, 999, {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        amountCents: 1,
      }),
    ).toThrow();
  });
});

// --- bulk operations --------------------------------------------------------

/** Three transactions on one card, so a selection can be a strict subset. */
function seedThree(repo: ExpenseRepository) {
  const account = seedAccount(repo);
  const transactions = ["ALPHA", "BETA", "GAMMA"].map((description, index) =>
    createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        transactionDescription: description,
        amountCents: (index + 1) * 1000,
        vendor: `vendor ${description}`,
        note: `note ${description}`,
      },
      1,
    ),
  );
  return { account, transactions };
}

describe("deleteTransactions", () => {
  it("deletes only the selected rows and reports the count", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    const deleted = deleteTransactions(repo, [transactions[0].id, transactions[2].id]);

    expect(deleted).toBe(2);
    expect(listTransactions(repo).map((t) => t.transactionDescription)).toEqual(["BETA"]);
  });

  it("counts a repeated id once", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    expect(deleteTransactions(repo, [transactions[0].id, transactions[0].id])).toBe(1);
    expect(listTransactions(repo)).toHaveLength(2);
  });

  it("ignores an id that no longer exists rather than failing the batch", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    const deleted = deleteTransactions(repo, [transactions[0].id, 9999]);

    expect(deleted).toBe(1);
    expect(listTransactions(repo)).toHaveLength(2);
  });

  it("rejects an empty selection", () => {
    expect(() => deleteTransactions(fakeRepo(), [])).toThrow(/at least one transaction/);
  });
});

describe("bulkEditTransactions", () => {
  it("applies one value to the named field across the selection", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    const changed = bulkEditTransactions(repo, [transactions[0].id, transactions[1].id], {
      categoryName: "Restaurant",
      status: "reconciled",
    });

    expect(changed).toBe(2);
    const saved = listTransactions(repo);
    expect(saved[0]).toMatchObject({ categoryName: "Restaurant", status: "reconciled" });
    expect(saved[1]).toMatchObject({ categoryName: "Restaurant", status: "reconciled" });
    // Untouched row keeps its own values.
    expect(saved[2]).toMatchObject({ categoryName: "", status: "new" });
  });

  it("leaves fields it wasn't given alone", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    bulkEditTransactions(repo, [transactions[0].id], { vendor: "TGI Friday" });

    expect(repo.getTransactionById(transactions[0].id)).toMatchObject({
      vendor: "TGI Friday",
      note: "note ALPHA", // untouched
      transactionDescription: "ALPHA", // untouched
      amountCents: 1000, // untouched
    });
  });

  it("clears a field when the value given is empty", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    bulkEditTransactions(repo, [transactions[0].id], { note: "" });

    expect(repo.getTransactionById(transactions[0].id)?.note).toBe("");
  });

  it("can re-queue rows for the clean-up run by clearing processed", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);
    bulkEditTransactions(repo, transactions.map((t) => t.id), { processed: true });
    expect(countUnprocessed(repo)).toBe(0);

    bulkEditTransactions(repo, [transactions[0].id], { processed: false });

    expect(countUnprocessed(repo)).toBe(1);
  });

  it("moves the selection to another card", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);
    const other = createAccount(repo, { name: "Amex", creditLineCents: 100000 });

    bulkEditTransactions(repo, [transactions[0].id], { transactionAccountId: other.id });

    expect(repo.getTransactionById(transactions[0].id)?.transactionAccountId).toBe(other.id);
  });

  it("auto-registers a category the bulk edit introduces", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    bulkEditTransactions(repo, [transactions[0].id], { categoryName: "Utilities" });

    expect(listCategories(repo).map((category) => category.name)).toContain("Utilities");
  });

  it("rejects an unknown account", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    expect(() =>
      bulkEditTransactions(repo, [transactions[0].id], { transactionAccountId: 999 }),
    ).toThrow(/No credit-card account/);
  });

  it("rejects a change set with nothing enabled", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    expect(() => bulkEditTransactions(repo, [transactions[0].id], {})).toThrow(
      /at least one field/,
    );
  });

  it("rejects an empty selection", () => {
    expect(() => bulkEditTransactions(fakeRepo(), [], { vendor: "x" })).toThrow(
      /at least one transaction/,
    );
  });

  it("rejects an unknown status", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    expect(() =>
      bulkEditTransactions(repo, [transactions[0].id], { status: "paid" as never }),
    ).toThrow();
  });

  it("never writes the transaction date or the amount, even if asked", () => {
    const repo = fakeRepo();
    const { transactions } = seedThree(repo);

    bulkEditTransactions(repo, [transactions[0].id], {
      vendor: "TGI Friday",
      transactionDate: "1999-01-01",
      amountCents: 1,
    } as never);

    expect(repo.getTransactionById(transactions[0].id)).toMatchObject({
      transactionDate: "2026-07-15",
      amountCents: 1000,
    });
  });
});

describe("vendors", () => {
  it("saves a vendor and reads it back", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco", description: "warehouse" });

    expect(listVendors(repo)).toHaveLength(1);
    expect(listVendors(repo)[0]).toMatchObject({ name: "Costco", description: "warehouse" });
  });

  it("updates the description rather than adding a second row", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco", description: "warehouse" });
    upsertVendor(repo, { name: "Costco", description: "bulk groceries" });

    expect(listVendors(repo)).toHaveLength(1);
    expect(listVendors(repo)[0].description).toBe("bulk groceries");
  });

  it("treats a differently-cased name as the same vendor", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco", description: "warehouse" });
    upsertVendor(repo, { name: "COSTCO", description: "same shop" });

    // One row, and the original spelling survives — the casing you first typed
    // is the one the screens show.
    expect(listVendors(repo)).toHaveLength(1);
    expect(listVendors(repo)[0]).toMatchObject({ name: "Costco", description: "same shop" });
  });

  it("rejects a blank name", () => {
    const repo = fakeRepo();
    expect(() => upsertVendor(repo, { name: "   " })).toThrow();
  });

  it("deletes a vendor without touching its transactions", () => {
    const repo = fakeRepo();
    const account = createAccount(repo, { name: "Visa" });
    upsertVendor(repo, { name: "Costco", description: "warehouse" });
    createTransaction(
      repo,
      {
        transactionDate: "2026-08-01",
        transactionAccountId: account.id,
        transactionDescription: "COSTCO WHSE #1017",
        vendor: "Costco",
        amountCents: 4500,
      },
      1,
    );

    deleteVendor(repo, "Costco");

    expect(listVendors(repo)).toHaveLength(0);
    // The vendor name stays on the transaction, so the spend rollups are intact
    // and the vendor comes straight back as a derived-only entry.
    expect(listTransactions(repo)).toHaveLength(1);
    expect(listTransactions(repo)[0].vendor).toBe("Costco");
  });
});

describe("vendor icons", () => {
  // Inlined at each call site rather than hoisted, so "image/png" narrows to the
  // mime-type union instead of widening to string — same as the tests above.
  const iconBase64 = Buffer.from("fake icon bytes").toString("base64");

  it("stores an icon and records its mime type on the vendor", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });

    setVendorIcon(repo, "Costco", { mimeType: "image/png", base64Data: iconBase64 });

    expect(getVendorIcon(repo, "Costco")?.mimeType).toBe("image/png");
    expect(repo.getVendorByName("Costco")?.iconMimeType).toBe("image/png");
  });

  it("creates the vendor row when uploading an icon for an unsaved vendor", () => {
    const repo = fakeRepo();

    // The case that separates vendors from categories: most vendors are derived
    // from a statement and have never been saved, so the upload has to create
    // the row rather than refuse.
    setVendorIcon(repo, "TRADER JOES", { mimeType: "image/png", base64Data: iconBase64 });

    expect(repo.getVendorByName("TRADER JOES")?.iconMimeType).toBe("image/png");
    expect(listVendors(repo)).toHaveLength(1);
  });

  it("finds the icon regardless of the casing asked for", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });
    setVendorIcon(repo, "Costco", { mimeType: "image/png", base64Data: iconBase64 });

    expect(getVendorIcon(repo, "COSTCO")?.mimeType).toBe("image/png");
    expect(getVendorIcon(repo, "costco")?.mimeType).toBe("image/png");
  });

  it("clears the icon again", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });
    setVendorIcon(repo, "Costco", { mimeType: "image/png", base64Data: iconBase64 });

    clearVendorIcon(repo, "Costco");

    expect(getVendorIcon(repo, "Costco")).toBeUndefined();
    expect(repo.getVendorByName("Costco")?.iconMimeType).toBeUndefined();
  });

  it("rejects a disallowed type, including SVG", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });

    expect(() =>
      setVendorIcon(repo, "Costco", {
        mimeType: "image/svg+xml" as never,
        base64Data: Buffer.from("<svg />").toString("base64"),
      }),
    ).toThrow();
  });

  it("rejects an icon over the size cap", () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });

    expect(() =>
      setVendorIcon(repo, "Costco", {
        mimeType: "image/png",
        base64Data: Buffer.alloc(MAX_VENDOR_ICON_BYTES + 1).toString("base64"),
      }),
    ).toThrow();
  });

  it("refuses to clear an icon for a vendor that doesn't exist", () => {
    const repo = fakeRepo();
    expect(() => clearVendorIcon(repo, "Nope")).toThrow(/No vendor named/);
  });
});

describe("applyRuleToExistingTransactions", () => {
  /** A processed row that a rule has already labelled — the case this feature exists for. */
  function seedProcessedRow(
    repo: ExpenseRepository,
    accountId: number,
    description: string,
  ) {
    return createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: accountId,
        transactionDescription: description,
        amountCents: 100,
      },
      1,
    );
  }

  it("overwrites a value an earlier version of the rule got wrong", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    seedProcessedRow(repo, account.id, "AMAZON MKTPL*2X4Y9");
    const wrong = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "categoryName", fieldValue: "groceries" }],
    });
    runCleanupBatch(repo);
    expect(listTransactions(repo)[0].categoryName).toBe("groceries");

    updateRule(repo, wrong.id, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "categoryName", fieldValue: "online-purchase" }],
    });
    const result = applyRuleToExistingTransactions(repo, wrong.id);

    expect(result).toMatchObject({ matchedCount: 1, changedCount: 1 });
    expect(listTransactions(repo)[0].categoryName).toBe("online-purchase");
  });

  it("leaves transactions the pattern doesn't match alone", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    seedProcessedRow(repo, account.id, "SQ *TGI FRIDAYS");
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "vendor", fieldValue: "Amazon" }],
    });

    const result = applyRuleToExistingTransactions(repo, created.id);

    expect(result.matchedCount).toBe(0);
    expect(listTransactions(repo)[0].vendor).toBe("");
  });

  it("never overwrites the status of a row that's already been reconciled", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    const row = seedProcessedRow(repo, account.id, "AMAZON MKTPL*2X4Y9");
    bulkEditTransactions(repo, [row.id], { status: "reconciled" });
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [
        { fieldName: "status", fieldValue: "new" },
        { fieldName: "vendor", fieldValue: "Amazon" },
      ],
    });

    const result = applyRuleToExistingTransactions(repo, created.id);

    expect(listTransactions(repo)[0].status).toBe("reconciled");
    expect(listTransactions(repo)[0].vendor).toBe("Amazon");
    expect(result.fieldsChanged).toEqual(["vendor"]);
  });

  it("doesn't count a row that already holds the rule's values as changed", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    seedProcessedRow(repo, account.id, "AMAZON MKTPL*2X4Y9");
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "vendor", fieldValue: "Amazon" }],
    });
    runCleanupBatch(repo);

    const result = applyRuleToExistingTransactions(repo, created.id);

    expect(result).toMatchObject({ matchedCount: 1, changedCount: 0 });
  });

  it("registers a category the corrected rule introduces", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    seedProcessedRow(repo, account.id, "AMAZON MKTPL*2X4Y9");
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "categoryName", fieldValue: "online-purchase" }],
    });

    applyRuleToExistingTransactions(repo, created.id);

    expect(listCategories(repo).map((category) => category.name)).toContain("online-purchase");
  });

  it("leaves the processed queue untouched — this runs outside it", () => {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    seedProcessedRow(repo, account.id, "AMAZON MKTPL*2X4Y9");
    const created = createRule(repo, {
      name: "Amazon",
      pattern: "AMAZON%",
      actions: [{ fieldName: "vendor", fieldValue: "Amazon" }],
    });

    applyRuleToExistingTransactions(repo, created.id);

    expect(countUnprocessed(repo)).toBe(1);
  });

  it("throws for a rule that doesn't exist", () => {
    const repo = fakeRepo();
    expect(() => applyRuleToExistingTransactions(repo, 999)).toThrow(/No rule with id 999/);
  });
});

describe("autoPopulateVendorIcon", () => {
  /** A logo client that answers from a table, so no test touches a network. */
  function fakeClient(
    logos: Record<string, { data: Buffer; mimeType: string } | undefined>,
    options: { throwFor?: string } = {},
  ) {
    const asked: string[] = [];
    return {
      asked,
      client: {
        async fetch(vendorName: string) {
          asked.push(vendorName);
          if (options.throwFor === vendorName) throw new Error("network down");
          const logo = logos[vendorName];
          return logo
            ? {
                ...logo,
                source: `https://example.test/${vendorName}`,
                domain: "example.test",
                via: "search" as const,
              }
            : undefined;
        },
      },
    };
  }

  const png = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" };

  it("stores a fetched logo and creates the vendor row", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient({ Costco: png });

    const result = await autoPopulateVendorIcon(repo, client, "Costco");

    expect(result).toMatchObject({ name: "Costco", outcome: "set", domain: "example.test" });
    expect(getVendorIcon(repo, "Costco")?.mimeType).toBe("image/png");
    expect(listVendors(repo).map((vendor) => vendor.name)).toContain("Costco");
  });

  it("never overwrites an icon that is already there", async () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "Costco" });
    setVendorIcon(repo, "Costco", {
      mimeType: "image/jpeg",
      base64Data: Buffer.from([1, 2, 3]).toString("base64"),
    });
    const { client, asked } = fakeClient({ Costco: png });

    const result = await autoPopulateVendorIcon(repo, client, "Costco");

    expect(result.outcome).toBe("already-has-icon");
    // The skip happens before the lookup, so a re-run costs no requests.
    expect(asked).toEqual([]);
    expect(getVendorIcon(repo, "Costco")?.mimeType).toBe("image/jpeg");
  });

  it("reports a vendor the service has no logo for, without creating a row", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient({});

    const result = await autoPopulateVendorIcon(repo, client, "Bob's Corner Store");

    expect(result).toEqual({ name: "Bob's Corner Store", outcome: "no-logo-found" });
    expect(listVendors(repo)).toEqual([]);
  });

  it("reports a broken lookup as failed rather than throwing", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient({ Costco: png }, { throwFor: "Costco" });

    const result = await autoPopulateVendorIcon(repo, client, "Costco");

    expect(result).toEqual({ name: "Costco", outcome: "failed" });
    expect(listVendors(repo)).toEqual([]);
  });

  it("keeps the saved spelling when the vendor row already exists", async () => {
    const repo = fakeRepo();
    upsertVendor(repo, { name: "COSTCO", description: "warehouse" });
    const { client } = fakeClient({ Costco: png });

    const result = await autoPopulateVendorIcon(repo, client, "Costco");

    expect(result.outcome).toBe("set");
    expect(result.name).toBe("COSTCO");
    // The description survives — an icon fetch must not blank the row.
    expect(listVendors(repo)[0].description).toBe("warehouse");
  });

  it("treats a blank name as a failure rather than asking for it", async () => {
    const repo = fakeRepo();
    const { client, asked } = fakeClient({});

    const result = await autoPopulateVendorIcon(repo, client, "   ");

    expect(result.outcome).toBe("failed");
    expect(asked).toEqual([]);
  });
});
