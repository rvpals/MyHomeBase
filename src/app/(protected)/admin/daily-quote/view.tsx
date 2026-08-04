"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { CreateQuoteInput, DailyQuote, QuoteCategory } from "@/lib/daily-quote";
import { createQuoteAction, deleteQuoteAction, updateQuoteAction } from "./actions";
import { NewsletterImport } from "./newsletter-import";
import { PAGE_CONTAINER } from "../../page-container";

export interface DailyQuoteViewProps {
  quotes: DailyQuote[];
  categories: readonly QuoteCategory[];
}

const inputClass =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Add/Edit form. Remounted (via key) when the edited quote changes, so its local
// state re-seeds from `initial`. Returns an error string from onSubmit to display.
function QuoteForm({
  initial,
  categories,
  onSubmit,
  onCancel,
}: {
  initial?: DailyQuote;
  categories: readonly QuoteCategory[];
  onSubmit: (input: CreateQuoteInput) => Promise<string | undefined>;
  onCancel?: () => void;
}) {
  const [quote, setQuote] = useState(initial?.quote ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [category, setCategory] = useState<QuoteCategory>(initial?.category ?? categories[0]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const failure = await onSubmit({ quote, author, category, source });
      if (failure) {
        setError(failure);
        return;
      }
      if (!initial) {
        setQuote("");
        setAuthor("");
        setSource("");
        setCategory(categories[0]);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Quote</span>
        <textarea
          value={quote}
          onChange={(event) => setQuote(event.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Enter the quote text…"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Author</span>
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            className={inputClass}
            placeholder="Unknown"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as QuoteCategory)}
            className={inputClass}
          >
            {categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Source</span>
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className={inputClass}
          placeholder="Optional — book, letter, talk…"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : initial ? "Save changes" : "Add quote"}
        </Button>
        {initial && onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function DailyQuoteView({ quotes, categories }: DailyQuoteViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<DailyQuote | null>(null);

  async function handleCreate(input: CreateQuoteInput): Promise<string | undefined> {
    const result = await createQuoteAction(input);
    if (!result.ok) return result.error ?? "Failed to create quote.";
    router.refresh();
    return undefined;
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

      <div className="mt-6 rounded-lg border border-line bg-paper-raised p-6">
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">
          {editing ? `Edit quote #${editing.id}` : "Add a quote"}
        </h2>
        <QuoteForm
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
          categories={categories}
          onSubmit={(input) => (editing ? handleUpdate(editing.id, input) : handleCreate(input))}
          onCancel={() => setEditing(null)}
        />
      </div>

      <div className="mt-6">
        <CollapsibleCard title="Import from newsletter">
          <NewsletterImport categories={categories} />
        </CollapsibleCard>
      </div>

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
