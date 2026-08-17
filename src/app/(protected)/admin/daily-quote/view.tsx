"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { CreateQuoteInput, DailyQuote, QuoteCategory } from "@/lib/daily-quote";
import { deleteQuoteAction, updateQuoteAction } from "./actions";
import { QuoteForm } from "./quote-form";
import { PAGE_CONTAINER } from "../../page-container";

export interface DailyQuoteViewProps {
  quotes: DailyQuote[];
  categories: readonly QuoteCategory[];
}

export function DailyQuoteView({ quotes, categories }: DailyQuoteViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<DailyQuote | null>(null);

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
      render: (row) => <span className="text-ink">{row.quote}</span>,
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
        every visit to the home page.
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
