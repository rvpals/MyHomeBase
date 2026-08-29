"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Tabs, type TabItem } from "@/components/tabs";
import {
  EXPENSE_IMAGE_MIME_TYPES,
  MAX_CARD_IMAGE_BYTES,
  MAX_CATEGORY_ICON_BYTES,
  MAX_VENDOR_ICON_BYTES,
  parseMoneyToCents,
  type CreditCardAccount,
  type ExpenseCategory,
  type VendorListEntry,
} from "@/lib/expense";
import {
  clearAccountImageAction,
  clearCategoryIconAction,
  clearVendorIconAction,
  deleteAccountAction,
  deleteCategoryAction,
  deleteVendorAction,
  saveAccountAction,
  saveAccountImageAction,
  saveCategoryAction,
  saveCategoryIconAction,
  saveVendorAction,
  saveVendorIconAction,
} from "./expense-actions";
import {
  CardThumbnail,
  CategoryIconThumbnail,
  VendorIconThumbnail,
  categoryIconUrl,
  formatCents,
  vendorIconUrl,
} from "./expense-shared";

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
          accept={EXPENSE_IMAGE_MIME_TYPES.join(",")}
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

/**
 * Upload / replace / remove the icon shown beside this category everywhere it
 * appears. Same shape as CardImageControls, but its own component because the
 * subject is a category (keyed by name) and the size cap is tighter.
 */
function CategoryIconControls({
  category,
  onError,
}: {
  category: ExpenseCategory;
  onError: (message: string | undefined) => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    onError(undefined);
    // Checked here too so an oversized file fails instantly, without a round
    // trip; the use-case enforces the same limit server-side.
    if (file.size > MAX_CATEGORY_ICON_BYTES) {
      onError(
        `"${file.name}" is too large — keep it under ${Math.round(MAX_CATEGORY_ICON_BYTES / 1024)} KB.`,
      );
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveCategoryIconAction(category.name, file.type, base64Data);
      if (!result.ok) onError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      <label className="cursor-pointer text-xs font-medium text-brass-dark hover:underline">
        {category.iconMimeType ? "Replace icon" : "Add icon"}
        <input
          type="file"
          accept={EXPENSE_IMAGE_MIME_TYPES.join(",")}
          disabled={isBusy}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {category.iconMimeType && (
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            onError(undefined);
            const result = await clearCategoryIconAction(category.name);
            if (result.ok) router.refresh();
            else onError(result.error);
          }}
          className="text-xs text-muted hover:text-red-400"
        >
          Remove icon
        </button>
      )}
    </span>
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
      <p className="text-sm text-muted">
        Categories are created automatically when you use a new name on a transaction or a rule —
        add one here to give it a description up front, or an icon that shows up wherever the
        category appears.
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
        // A row per category rather than the chips this used to be: each one now
        // carries its own icon controls, which a chip has no room for.
        <ul className="flex flex-col gap-1">
          {categories.map((category) => (
            <li
              key={category.name}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <CategoryIconThumbnail iconUrl={categoryIconUrl(category)} />
              <span className="text-ink">{category.name}</span>
              {category.description !== "" && (
                <span className="text-xs text-muted">{category.description}</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <CategoryIconControls category={category} onError={setError} />
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

/**
 * Upload / replace / remove a vendor's icon. Same shape as CategoryIconControls,
 * but the subject may not be saved yet — `saveVendorIconAction` creates the row
 * on the way in, so an icon can be dropped straight onto a vendor that so far
 * only exists on a statement.
 */
function VendorIconControls({
  vendor,
  onError,
}: {
  vendor: VendorListEntry;
  onError: (message: string | undefined) => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    onError(undefined);
    // Checked here too so an oversized file fails instantly, without a round
    // trip; the use-case enforces the same limit server-side.
    if (file.size > MAX_VENDOR_ICON_BYTES) {
      onError(
        `"${file.name}" is too large — keep it under ${Math.round(MAX_VENDOR_ICON_BYTES / 1024)} KB.`,
      );
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveVendorIconAction(vendor.name, file.type, base64Data);
      if (!result.ok) onError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      <label className="cursor-pointer text-xs font-medium text-brass-dark hover:underline">
        {vendor.iconMimeType ? "Replace icon" : "Add icon"}
        <input
          type="file"
          accept={EXPENSE_IMAGE_MIME_TYPES.join(",")}
          disabled={isBusy}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {vendor.iconMimeType && (
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            onError(undefined);
            const result = await clearVendorIconAction(vendor.name);
            if (result.ok) router.refresh();
            else onError(result.error);
          }}
          className="text-xs text-muted hover:text-red-400"
        >
          Remove icon
        </button>
      )}
    </span>
  );
}

/**
 * One tab's worth of vendor rows. Split out of VendorsPanel so the Saved and
 * Unsaved tabs render the same row markup over different slices, rather than the
 * list being duplicated per tab.
 *
 * The panel keeps ownership of the form and the error state, so editing a vendor
 * from either tab drives the one form above the tabs.
 */
function VendorRows({
  vendors,
  emptyMessage,
  onEdit,
  onError,
}: {
  vendors: VendorListEntry[];
  emptyMessage: string;
  onEdit: (vendor: VendorListEntry) => void;
  onError: (message: string | undefined) => void;
}) {
  const router = useRouter();

  if (vendors.length === 0) return <p className="text-sm text-muted">{emptyMessage}</p>;

  return (
    <ul className="flex flex-col gap-1">
      {vendors.map((vendor) => (
        <li
          key={vendor.name}
          className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
        >
          <VendorIconThumbnail iconUrl={vendorIconUrl(vendor)} />
          <span className="text-ink">{vendor.name}</span>
          {vendor.description !== "" && (
            <span className="text-xs text-muted">{vendor.description}</span>
          )}
          {/* Why a vendor is listed at all: spend when it's on a transaction,
              otherwise it's a saved row whose transactions have gone. */}
          {vendor.isInUse ? (
            <span className="font-mono text-xs text-muted">
              {formatCents(vendor.totalCents)} over {vendor.transactionCount}
            </span>
          ) : (
            <span className="text-xs text-muted">no transactions</span>
          )}
          <span className="ml-auto flex items-center gap-3">
            <VendorIconControls vendor={vendor} onError={onError} />
            <button
              type="button"
              onClick={() => onEdit(vendor)}
              className="text-xs font-medium text-brass-dark hover:underline"
            >
              Edit
            </button>
            {/* Only a saved vendor has anything to delete. A derived one has no
                row, so the button would be a no-op that looks like a failure. */}
            {vendor.isSaved && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete "${vendor.name}"? Its description and icon go; transactions keep the vendor name, so it stays in your spend totals.`,
                    )
                  )
                    return;
                  const result = await deleteVendorAction(vendor.name);
                  if (result.ok) router.refresh();
                  else window.alert(result.error);
                }}
                className="text-xs font-medium text-red-400 hover:underline"
              >
                Delete
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VendorsPanel({ vendors }: { vendors: VendorListEntry[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<VendorListEntry | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(vendor: VendorListEntry) {
    setEditing(vendor);
    setName(vendor.name);
    setDescription(vendor.description);
  }

  function reset() {
    setEditing(undefined);
    setName("");
    setDescription("");
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await saveVendorAction({ name, description });
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

  // The two halves the merge already distinguishes. `mergeVendorsWithTotals`
  // sorts saved-first, so each filter keeps its own spend-then-name order.
  const saved = vendors.filter((vendor) => vendor.isSaved);
  const unsaved = vendors.filter((vendor) => !vendor.isSaved);

  // Counts in the labels: with the lists split you can no longer see how much is
  // in the tab you're not looking at, and the unsaved backlog is the whole reason
  // to switch. The "unsaved" pill on each row goes away — the tab now says it.
  const tabs: TabItem[] = [
    {
      key: "saved",
      label: `Saved (${saved.length})`,
      content: (
        <VendorRows
          vendors={saved}
          emptyMessage="No saved vendors yet — give one a description or an icon and it lands here."
          onEdit={startEdit}
          onError={setError}
        />
      ),
    },
    {
      key: "unsaved",
      label: `Unsaved (${unsaved.length})`,
      content: (
        <VendorRows
          vendors={unsaved}
          emptyMessage="Nothing unsaved — every vendor in your transactions has been saved."
          onEdit={startEdit}
          onError={setError}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Vendors are read from your transactions — the tidy name your post-import rules set,
        falling back to the brand in the raw statement text. Saving one gives it a
        description, or an icon that shows up wherever the vendor appears; until then it
        sits under <strong className="text-ink">Unsaved</strong>. Adding an icon saves it
        too. Names match regardless of case.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="COSTCO"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isSaving || name.trim() === ""}>
          {isSaving ? "Saving…" : editing ? "Save vendor" : "Add vendor"}
        </Button>
        {editing && (
          <Button size="sm" variant="secondary" onClick={reset} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>

      <Tabs items={tabs} />
    </div>
  );
}

export function ExpenseAccountsView({
  accounts,
  categories,
  vendors,
}: {
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
  vendors: VendorListEntry[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <CollapsibleCard title="Credit Card Accounts" defaultOpen>
        <AccountsPanel accounts={accounts} />
      </CollapsibleCard>
      <CollapsibleCard title="Categories" defaultOpen>
        <CategoriesPanel categories={categories} />
      </CollapsibleCard>
      {/* Collapsed by default, unlike its siblings: this list is as long as your
          vendor history, so opening it is a choice rather than the default view. */}
      <CollapsibleCard title="Vendors">
        <VendorsPanel vendors={vendors} />
      </CollapsibleCard>
    </div>
  );
}
