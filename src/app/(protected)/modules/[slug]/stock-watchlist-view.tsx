"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  summarizeWatch,
  type StockWatchList,
  type StockWatchListItem,
  type UpdateWatchListItemWatchInput,
  type WatchKindOrNone,
} from "@/lib/stock-watchlist";
import { dollarsToCents, formatCents } from "@/lib/shared/money";
import { TickerCell, TickerViewerHost } from "./ticker-viewer-host";
import {
  addWatchListItemAction,
  createWatchListAction,
  deleteWatchListAction,
  deleteWatchListItemAction,
  renameWatchListAction,
  updateWatchListItemWatchAction,
} from "./stock-watchlist-actions";

const FIELD_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * The picker's options, in the order the reader meets them. The value is the
 * stored `watch_kind`, so these strings are not free to rename (migrations/0111).
 */
const WATCH_OPTIONS: { value: WatchKindOrNone; label: string }[] = [
  { value: "", label: "Nothing" },
  { value: "price", label: "Price" },
  { value: "price_range", label: "Price range" },
  { value: "dividend", label: "Dividend" },
  { value: "split", label: "Split" },
  { value: "gain_loss_pct", label: "Gain/loss %" },
  { value: "gain_loss_price", label: "Gain/loss price" },
];

/** What the value box asks for, per kind. Blank means the kind reads no value. */
function valueHint(kind: WatchKindOrNone): { label: string; placeholder: string } | undefined {
  switch (kind) {
    case "price":
      return { label: "Watch value", placeholder: "100" };
    case "price_range":
      return { label: "From", placeholder: "10" };
    case "gain_loss_pct":
      return { label: "Swing %", placeholder: "20" };
    case "gain_loss_price":
      return { label: "Swing $/share", placeholder: "10" };
    default:
      // dividend, split and "nothing" read no value at all.
      return undefined;
  }
}

/**
 * The form's watch fields as typed — strings, because an `<input>` holds text
 * and a half-typed "1." is not a number yet.
 */
interface WatchDraft {
  kind: WatchKindOrNone;
  value: string;
  valueHigh: string;
}

const EMPTY_WATCH: WatchDraft = { kind: "", value: "", valueHigh: "" };

/**
 * Converts what was typed into the domain units the schema expects: cents for
 * the money kinds, a plain percent for the percentage one.
 *
 * Done here rather than in the action because this is where the units are
 * known — the reader types dollars, and everything below the boundary is cents
 * (`src/lib/shared/money.ts`).
 */
function toWatchInput(draft: WatchDraft): UpdateWatchListItemWatchInput {
  if (draft.kind === "") return { watchKind: "" };
  if (draft.kind === "dividend" || draft.kind === "split") return { watchKind: draft.kind };

  const isMoney = draft.kind !== "gain_loss_pct";
  const parse = (raw: string): number => {
    const typed = Number(raw || "0");
    if (!Number.isFinite(typed)) return 0;
    return isMoney ? dollarsToCents(typed) : typed;
  };

  return {
    watchKind: draft.kind,
    watchValue: parse(draft.value),
    watchValueHigh: draft.kind === "price_range" ? parse(draft.valueHigh) : 0,
  };
}

/**
 * The "watch ticker for" pair of fields — a kind picker and whatever value that
 * kind reads. Shared by the add form and the per-row editor so the two can
 * never offer different options.
 *
 * The value boxes are *absent*, not disabled, for the kinds that read no value:
 * a greyed-out box beside "Dividend" invites the reader to wonder what it wants.
 */
function WatchFields({
  draft,
  onChange,
}: {
  draft: WatchDraft;
  onChange: (next: WatchDraft) => void;
}) {
  const hint = valueHint(draft.kind);

  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Watch ticker for</span>
        <select
          value={draft.kind}
          onChange={(event) =>
            // The value boxes are cleared with the kind: a "100" left over from
            // a price target means something entirely different as a percentage.
            onChange({ ...EMPTY_WATCH, kind: event.target.value as WatchKindOrNone })
          }
          className={`w-40 ${FIELD_CLASS}`}
        >
          {WATCH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {hint && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">{hint.label}</span>
          <input
            inputMode="decimal"
            value={draft.value}
            placeholder={hint.placeholder}
            onChange={(event) => onChange({ ...draft, value: event.target.value })}
            className={`w-28 ${FIELD_CLASS}`}
          />
        </label>
      )}

      {draft.kind === "price_range" && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">To</span>
          <input
            inputMode="decimal"
            value={draft.valueHigh}
            placeholder="15"
            onChange={(event) => onChange({ ...draft, valueHigh: event.target.value })}
            className={`w-28 ${FIELD_CLASS}`}
          />
        </label>
      )}
    </>
  );
}

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
  const [watch, setWatch] = useState<WatchDraft>(EMPTY_WATCH);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await addWatchListItemAction(watchListId, {
        ticker,
        shares,
        addedDate,
        watch: toWatchInput(watch),
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to add ticker.");
        return;
      }
      setTicker("");
      setShares("");
      setWatch(EMPTY_WATCH);
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
      <WatchFields draft={watch} onChange={setWatch} />
      <Button type="submit" disabled={isSaving || ticker.trim() === "" || addedDate.trim() === ""}>
        {isSaving ? "Adding…" : "Add Ticker"}
      </Button>
      {/* Full-width so a validation sentence wraps under the row rather than
          stretching it -- the fields already wrap on a narrow screen. */}
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

/**
 * Editing the watch on a row that already exists, in place.
 *
 * A row rather than a dialog: it is two fields, and the reader is looking at
 * the list they want to compare against. Saving clears the latch (the
 * repository does it), so a new target's first crossing still reports.
 */
function WatchCell({ item }: { item: StockWatchListItem }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<WatchDraft>(EMPTY_WATCH);
  const [isSaving, setIsSaving] = useState(false);

  function startEditing() {
    // Seeded from what is stored, converted back into what the reader typed.
    const isMoney = item.watchKind !== "gain_loss_pct";
    const asTyped = (cents: number): string =>
      cents === 0 ? "" : String(isMoney ? cents / 100 : cents);

    setDraft({
      kind: item.watchKind,
      value: asTyped(item.watchValue),
      valueHigh: asTyped(item.watchValueHigh),
    });
    setIsEditing(true);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await updateWatchListItemWatchAction(item.id, toWatchInput(draft));
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setIsEditing(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="text-left text-xs text-muted hover:text-ink hover:underline"
        title="Change what this row watches for"
      >
        {/* The live marker: the last thing this watch said, if it is still
            latched. Derived from the stored message rather than re-evaluated,
            because a render must not fetch a quote. */}
        {item.watchIsTriggered && <span className="mr-1 text-brass-dark">●</span>}
        {summarizeWatch(item)}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <WatchFields draft={draft} onChange={setDraft} />
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="text-xs font-medium text-brass-dark hover:underline"
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setIsEditing(false)}
        className="text-xs font-medium text-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

function WatchListCard({
  entry,
  onOpenTicker,
}: {
  entry: WatchListEntry;
  onOpenTicker: (ticker: string) => void;
}) {
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
    {
      key: "ticker",
      header: "Ticker",
      value: (item) => item.ticker,
      render: (item) => <TickerCell ticker={item.ticker} onOpen={onOpenTicker} />,
    },
    { key: "shares", header: "Shares", render: (item) => item.shares },
    {
      key: "priceWhenAdded",
      header: "Price Added",
      render: (item) => formatCents(item.priceWhenAddedCents),
    },
    { key: "addedDate", header: "Added", render: (item) => item.addedDate },
    {
      key: "watch",
      header: "Watching",
      // `value` so the column sorts and exports by what it watches; the cell
      // itself is an editor, which CSV cannot carry.
      value: (item) => summarizeWatch(item),
      render: (item) => <WatchCell item={item} />,
    },
    {
      key: "watchLastMessage",
      header: "Last Alert",
      value: (item) => item.watchLastMessage,
      render: (item) => (
        <span className="text-xs text-muted">{item.watchLastMessage || "—"}</span>
      ),
    },
    {
      key: "reminder",
      header: "Reminder",
      render: (item) => <span className="text-muted">{item.reminderMessage || "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
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
  // Held here rather than per card so one dialog serves every list on the page.
  const [openTicker, setOpenTicker] = useState<string | undefined>(undefined);

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
          entries.map((entry) => (
            <WatchListCard key={entry.list.id} entry={entry} onOpenTicker={setOpenTicker} />
          ))
        )}
      </div>

      {openTicker && (
        <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
      )}
    </div>
  );
}
