"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { CreateQuoteInput, DailyQuote, QuoteCategory } from "@/lib/daily-quote";
import { deleteQuoteAction, setQuoteEnabledAction, updateQuoteAction } from "./actions";
import { QuoteForm } from "./quote-form";
import { PAGE_CONTAINER } from "../../page-container";

export interface DailyQuoteViewProps {
  quotes: DailyQuote[];
  categories: readonly QuoteCategory[];
}

export function DailyQuoteView({ quotes, categories }: DailyQuoteViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<DailyQuote | null>(null);

  async function handleSetEnabled(row: DailyQuote) {
    const result = await setQuoteEnabledAction(row.id, !row.isEnabled);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    // An open editor holds a stale copy of the row it was seeded from; saving it
    // afterwards would write the old flag straight back over this toggle.
    if (editing?.id === row.id) setEditing(null);
    router.refresh();
  }

  async function handleUpdate(id: number, input: CreateQuoteInput): Promise<string | undefined> {
    const result = await updateQuoteAction(id, input);
    if (!result.ok) return result.error ?? "Failed to update quote.";
    setEditing(null);
    router.refresh();
    return undefined;
  }

  const columns: DataGridColumn<DailyQuote>[] = [
    {
      key: "quote",
      header: "Quote",
      value: (row) => row.quote,
      render: (row) => (
        <span className={row.isEnabled ? "text-ink" : "text-muted line-through"}>{row.quote}</span>
      ),
    },
    {
      key: "author",
      header: "Author",
      value: (row) => row.author,
      render: (row) => <span className="text-muted">{row.author}</span>,
    },
    {
      key: "source",
      header: "Source",
      value: (row) => row.source,
      render: (row) => <span className="text-xs text-muted">{row.source}</span>,
    },
    {
      key: "category",
      header: "Category",
      value: (row) => row.category,
      render: (row) => (
        <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
          {row.category}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      // Sorts and exports as the word on screen, so a CSV of this grid reads the
      // same as the grid does.
      value: (row) => (row.isEnabled ? "Enabled" : "Disabled"),
      render: (row) =>
        row.isEnabled ? (
          <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-muted">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-400">
            Disabled
          </span>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (row) => (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleSetEnabled(row)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {row.isEnabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Delete this quote? This cannot be undone.")) return;
              const result = await deleteQuoteAction(row.id);
              if (result.ok) {
                if (editing?.id === row.id) setEditing(null);
                router.refresh();
              } else {
                window.alert(result.error);
              }
            }}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Daily Quote</h1>
      <p className="mt-2 text-sm text-muted">
        Manage the inspirational quotes shown on the home screen. A random quote is picked on
        every visit to the home page. Disabled quotes stay in this list but are never picked —
        if every quote is disabled, the home screen shows no quote at all.
      </p>

      {/* Adding moved to its own screen (Daily Quote → Add Quote); editing stays
          here, because Edit is pressed on a row of the grid below. */}
      {editing && (
        <div className="mt-6 rounded-lg border border-line bg-paper-raised p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">
            Edit quote #{editing.id}
          </h2>
          <QuoteForm
            key={editing.id}
            initial={editing}
            categories={categories}
            onSubmit={(input) => handleUpdate(editing.id, input)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <div className="mt-6">
        <DataGrid
          columns={columns}
          rows={quotes}
          getRowKey={(row) => row.id}
          emptyMessage="No quotes yet."
          exportFileName="daily-quotes"
        />
      </div>
    </div>
  );
}
