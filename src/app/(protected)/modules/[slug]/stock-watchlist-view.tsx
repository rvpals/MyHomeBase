"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { StockWatchList, StockWatchListItem } from "@/lib/stock-watchlist";
import { formatCents } from "@/lib/shared/money";
import {
  addWatchListItemAction,
  createWatchListAction,
  deleteWatchListAction,
  deleteWatchListItemAction,
  renameWatchListAction,
} from "./stock-watchlist-actions";

export interface WatchListEntry {
  list: StockWatchList;
  items: StockWatchListItem[];
}

function NewWatchListForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await createWatchListAction(name);
      if (!result.ok) {
        setError(result.error ?? "Failed to create watch list.");
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Watch list name"
        className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      />
      <Button type="submit" disabled={isSaving || name.trim() === ""}>
        {isSaving ? "Creating…" : "New Watch List"}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

function AddItemForm({ watchListId }: { watchListId: number }) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [addedDate, setAddedDate] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await addWatchListItemAction(watchListId, { ticker, shares, addedDate });
      if (!result.ok) {
        setError(result.error ?? "Failed to add ticker.");
        return;
      }
      setTicker("");
      setShares("");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap items-end gap-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Ticker</span>
        <input
          value={ticker}
          onChange={(event) => setTicker(event.target.value.toUpperCase())}
          className="w-28 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Shares</span>
        <input
          value={shares}
          onChange={(event) => setShares(event.target.value)}
          className="w-24 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Added</span>
        <input
          type="date"
          value={addedDate}
          onChange={(event) => setAddedDate(event.target.value)}
          className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <Button type="submit" disabled={isSaving || ticker.trim() === "" || addedDate.trim() === ""}>
        {isSaving ? "Adding…" : "Add Ticker"}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

function WatchListCard({ entry }: { entry: WatchListEntry }) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(entry.list.name);

  async function handleRename() {
    const result = await renameWatchListAction(entry.list.id, name);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setIsRenaming(false);
    router.refresh();
  }

  async function handleDeleteList() {
    if (!window.confirm(`Delete "${entry.list.name}" and all its tickers?`)) return;
    const result = await deleteWatchListAction(entry.list.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  async function handleDeleteItem(item: StockWatchListItem) {
    const result = await deleteWatchListItemAction(item.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<StockWatchListItem>[] = [
    { key: "ticker", header: "Ticker", render: (item) => item.ticker },
    { key: "shares", header: "Shares", render: (item) => item.shares },
    {
      key: "priceWhenAdded",
      header: "Price Added",
      render: (item) => formatCents(item.priceWhenAddedCents),
    },
    { key: "addedDate", header: "Added", render: (item) => item.addedDate },
    {
      key: "reminder",
      header: "Reminder",
      render: (item) => <span className="text-muted">{item.reminderMessage || "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (item) => (
        <button
          type="button"
          onClick={() => handleDeleteItem(item)}
          className="text-xs font-medium text-red-400 hover:underline"
        >
          Remove
        </button>
      ),
    },
  ];

  return (
    <CollapsibleCard title={entry.list.name}>
      <div className="mb-3 flex justify-end gap-3">
        {!isRenaming && (
          <button
            type="button"
            onClick={() => setIsRenaming(true)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Rename
          </button>
        )}
        {isRenaming && (
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink"
            />
            <button type="button" onClick={handleRename} className="text-xs font-medium text-brass-dark hover:underline">
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="text-xs font-medium text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleDeleteList}
          className="text-xs font-medium text-red-400 hover:underline"
        >
          Delete List
        </button>
      </div>
      <AddItemForm watchListId={entry.list.id} />
      <DataGrid columns={columns} rows={entry.items} getRowKey={(item) => item.id} emptyMessage="Nothing on this list yet." />
    </CollapsibleCard>
  );
}

export function StockWatchlistView({ entries }: { entries: WatchListEntry[] }) {
  return (
    <div>
      <h2 className="font-display text-xl text-ink">Watch Lists</h2>
      <div className="mt-4">
        <NewWatchListForm />
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No watch lists yet.</p>
        ) : (
          entries.map((entry) => <WatchListCard key={entry.list.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
