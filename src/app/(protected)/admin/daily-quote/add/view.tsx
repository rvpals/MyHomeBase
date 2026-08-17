"use client";

import { useRouter } from "next/navigation";
import type { CreateQuoteInput, QuoteCategory } from "@/lib/daily-quote";
import { createQuoteAction } from "../actions";
import { QuoteForm } from "../quote-form";
import { PAGE_CONTAINER } from "../../../page-container";

export function AddQuoteView({ categories }: { categories: readonly QuoteCategory[] }) {
  const router = useRouter();

  async function handleCreate(input: CreateQuoteInput): Promise<string | undefined> {
    const result = await createQuoteAction(input);
    if (!result.ok) return result.error ?? "Failed to create quote.";
    router.refresh();
    return undefined;
  }

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Daily Quote
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Add Quote</h1>
      <p className="mt-2 text-sm text-muted">
        Add one quote by hand. It joins the pool a random quote is picked from on every visit
        to the home page.
      </p>

      <div className="mt-6 rounded-lg border border-line bg-paper-raised p-6">
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">Add a quote</h2>
        <QuoteForm categories={categories} onSubmit={handleCreate} />
      </div>
    </div>
  );
}
