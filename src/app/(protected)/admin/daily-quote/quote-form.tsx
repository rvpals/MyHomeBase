"use client";

// Shared by two screens: the Add Quote page (create mode) and the quote list's
// inline Edit (`initial` supplied). Local to this route rather than a registered
// component — it's a form for one table, not a reusable shape.

import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import type { CreateQuoteInput, DailyQuote, QuoteCategory } from "@/lib/daily-quote";

export const QUOTE_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Add/Edit form. Remounted (via key) when the edited quote changes, so its local
// state re-seeds from `initial`. Returns an error string from onSubmit to display.
export function QuoteForm({
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
          className={QUOTE_INPUT_CLASS}
          placeholder="Enter the quote text…"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Author</span>
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            className={QUOTE_INPUT_CLASS}
            placeholder="Unknown"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as QuoteCategory)}
            className={QUOTE_INPUT_CLASS}
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
          className={QUOTE_INPUT_CLASS}
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
