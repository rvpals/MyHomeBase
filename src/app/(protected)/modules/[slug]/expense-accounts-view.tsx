"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import {
  CARD_IMAGE_MIME_TYPES,
  MAX_CARD_IMAGE_BYTES,
  parseMoneyToCents,
  type CreditCardAccount,
  type ExpenseCategory,
} from "@/lib/expense";
import {
  clearAccountImageAction,
  deleteAccountAction,
  deleteCategoryAction,
  saveAccountAction,
  saveAccountImageAction,
  saveCategoryAction,
} from "./expense-actions";
import { CardThumbnail, formatCents } from "./expense-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Reads a File as bare base64 (no data-URL prefix), which is what the action wants. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the image."));
    reader.readAsDataURL(file);
  });
}

/** Upload / replace / remove the small image that distinguishes this card. */
function CardImageControls({
  account,
  onError,
}: {
  account: CreditCardAccount;
  onError: (message: string | undefined) => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    onError(undefined);
    // Checked here too so an oversized file fails instantly, without a round
    // trip; the use-case enforces the same limit server-side.
    if (file.size > MAX_CARD_IMAGE_BYTES) {
      onError(`"${file.name}" is too large — keep it under ${Math.round(MAX_CARD_IMAGE_BYTES / 1024)} KB.`);
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveAccountImageAction(account.id, file.type, base64Data);
      if (!result.ok) onError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <label className="cursor-pointer text-xs font-medium text-brass-dark hover:underline">
        {account.imageMimeType ? "Replace image" : "Add image"}
        <input
          type="file"
          accept={CARD_IMAGE_MIME_TYPES.join(",")}
          disabled={isBusy}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {account.imageMimeType && (
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            onError(undefined);
            const result = await clearAccountImageAction(account.id);
            if (result.ok) router.refresh();
            else onError(result.error);
          }}
          className="text-xs text-muted hover:text-red-400"
        >
          Remove image
        </button>
      )}
    </span>
  );
}

function AccountsPanel({ accounts }: { accounts: CreditCardAccount[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CreditCardAccount | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creditLineText, setCreditLineText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(account: CreditCardAccount) {
    setEditing(account);
    setName(account.name);
    setDescription(account.description);
    setCreditLineText((account.creditLineCents / 100).toFixed(2));
  }

  function reset() {
    setEditing(undefined);
    setName("");
    setDescription("");
    setCreditLineText("");
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await saveAccountAction(editing?.id, {
        name,
        description,
        creditLineCents: parseMoneyToCents(creditLineText) ?? 0,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-lg text-ink">Credit-card accounts</h3>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Visa …1234" className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Credit line</span>
          <input value={creditLineText} onChange={(event) => setCreditLineText(event.target.value)} placeholder="5000.00" className={INPUT_CLASS} />
        </label>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isSaving || name.trim() === ""}>
          {isSaving ? "Saving…" : editing ? "Save account" : "Add account"}
        </Button>
        {editing && (
          <Button size="sm" variant="secondary" onClick={reset} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">No accounts yet — add the card you want to track.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <CardThumbnail account={account} />
              <span className="text-ink">{account.name}</span>
              {account.description !== "" && (
                <span className="text-xs text-muted">{account.description}</span>
              )}
              {account.creditLineCents > 0 && (
                <span className="font-mono text-xs text-muted">
                  limit {formatCents(account.creditLineCents)}
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <CardImageControls account={account} onError={setError} />
                <button
                  type="button"
                  onClick={() => startEdit(account)}
                  className="text-xs font-medium text-brass-dark hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await deleteAccountAction(account.id);
                    // Deleting is refused while transactions still reference it —
                    // show that reason rather than failing silently.
                    if (result.ok) router.refresh();
                    else window.alert(result.error);
                  }}
                  className="text-xs font-medium text-red-400 hover:underline"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoriesPanel({ categories }: { categories: ExpenseCategory[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    setError(undefined);
    const result = await saveCategoryAction({ name, description });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setDescription("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-lg text-ink">Categories</h3>
      <p className="text-sm text-muted">
        Categories are created automatically when you use a new name on a transaction or a rule —
        add one here to give it a description up front.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="groceries" className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      <div>
        <Button size="sm" onClick={handleSave} disabled={name.trim() === ""}>
          Save category
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-muted">No categories yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <li
              key={category.name}
              className="flex items-center gap-1 rounded-full bg-line/60 px-2 py-0.5 text-xs text-ink"
              title={category.description}
            >
              {category.name}
              <button
                type="button"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete "${category.name}"? Transactions keep their history but become uncategorised.`,
                    )
                  )
                    return;
                  const result = await deleteCategoryAction(category.name);
                  if (result.ok) router.refresh();
                  else window.alert(result.error);
                }}
                aria-label={`Delete ${category.name}`}
                className="text-muted hover:text-red-400"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExpenseAccountsView({
  accounts,
  categories,
}: {
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <AccountsPanel accounts={accounts} />
      <CategoriesPanel categories={categories} />
    </div>
  );
}
