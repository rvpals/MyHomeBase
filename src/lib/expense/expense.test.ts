import { describe, expect, it } from "vitest";
import {
  applyRulesToExistingTransactions,
  clearAccountImage,
  createAccount,
  createRule,
  createTransaction,
  deleteAccount,
  deleteCategory,
  listCategories,
  listTransactions,
  getAccountImage,
  previewPatternMatches,
  setAccountImage,
  totalsByCategory,
  updateTransaction,
} from "./expense";
import { MAX_CARD_IMAGE_BYTES } from "./schema";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import type {
  AccountWriteData,
  CategoryRuleWriteData,
  CategoryWriteData,
  TransactionWriteData,
} from "./schema";
import type {
  CardImage,
  CategoryRule,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
} from "./types";

// Hand-written in-memory fake implementing the port.
function fakeRepo(): ExpenseRepository {
  let accounts: CreditCardAccount[] = [];
  let categories: ExpenseCategory[] = [];
  let transactions: ExpenseTransaction[] = [];
  let rules: CategoryRule[] = [];
  const images = new Map<number, CardImage>();
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
    transactionExists: (input) =>
      transactions.some(
        (transaction) =>
          transaction.transactionAccountId === input.transactionAccountId &&
          transaction.transactionDate === input.transactionDate &&
          transaction.transactionDescription === input.transactionDescription &&
          transaction.amountCents === input.amountCents,
      ),
    setTransactionCategoryAndStatus(id, categoryName, status) {
      transactions = transactions.map((transaction) =>
        transaction.id === id
          ? { ...transaction, categoryName, status: status as ExpenseTransaction["status"] }
          : transaction,
      );
    },

    listRules: () => [...rules].sort((a, b) => (a.priority === b.priority ? a.id - b.id : a.priority - b.priority)),
    getRuleById: (id) => rules.find((rule) => rule.id === id),
    createRule(input: CategoryRuleWriteData) {
      const created: CategoryRule = { id: nextRuleId++, ...input, createdAt: now, updatedAt: now };
      rules.push(created);
      return created;
    },
    updateRule(id, input) {
      rules = rules.map((rule) => (rule.id === id ? { ...rule, ...input } : rule));
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

describe("applyRulesToExistingTransactions", () => {
  function setup() {
    const repo = fakeRepo();
    const account = seedAccount(repo);
    createTransaction(
      repo,
      {
        transactionDate: "2026-07-15",
        transactionAccountId: account.id,
        transactionDescription: "AMAZON MKTPL*2X4Y9",
        amountCents: 2033,
      },
      1,
    );
    createTransaction(
      repo,
      {
        transactionDate: "2026-07-16",
        transactionAccountId: account.id,
        transactionDescription: "LOCAL BAKERY",
        amountCents: 750,
      },
      1,
    );
    return { repo, account };
  }

  it("categorises matching uncategorised rows and reports what changed", () => {
    const { repo } = setup();
    createRule(repo, { pattern: "AMAZON*", categoryName: "online-purchase" });

    const summary = applyRulesToExistingTransactions(repo);

    expect(summary.categorisedCount).toBe(1);
    expect(summary.examinedCount).toBe(2);
    expect(summary.byRule[0]).toMatchObject({ pattern: "AMAZON*", categoryName: "online-purchase", count: 1 });
    expect(listTransactions(repo).find((t) => t.transactionDescription.startsWith("AMAZON"))?.categoryName)
      .toBe("online-purchase");
  });

  it("applies the rule's status when it sets one", () => {
    const { repo } = setup();
    createRule(repo, {
      pattern: "AMAZON*",
      categoryName: "online-purchase",
      applyStatus: "reconciled",
    });

    applyRulesToExistingTransactions(repo);

    const amazon = listTransactions(repo).find((t) => t.transactionDescription.startsWith("AMAZON"));
    expect(amazon?.status).toBe("reconciled");
  });

  it("is idempotent — a second run changes nothing", () => {
    const { repo } = setup();
    createRule(repo, { pattern: "AMAZON*", categoryName: "online-purchase" });

    applyRulesToExistingTransactions(repo);
    const second = applyRulesToExistingTransactions(repo);

    expect(second.categorisedCount).toBe(0);
  });

  it("leaves a manually categorised row alone", () => {
    const { repo, account } = setup();
    const manual = createTransaction(
      repo,
      {
        transactionDate: "2026-07-17",
        transactionAccountId: account.id,
        transactionDescription: "AMAZON MKTPL*ZZZ",
        amountCents: 500,
        categoryName: "gift",
      },
      1,
    );
    createRule(repo, { pattern: "AMAZON*", categoryName: "online-purchase" });

    applyRulesToExistingTransactions(repo);

    expect(repo.getTransactionById(manual.id)?.categoryName).toBe("gift");
  });

  it("registers the rule's category so the managed list stays complete", () => {
    const { repo } = setup();
    createRule(repo, { pattern: "AMAZON*", categoryName: "online-purchase" });
    expect(listCategories(repo).map((c) => c.name)).toContain("online-purchase");
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

    const preview = previewPatternMatches(repo, "AMAZON*");

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
