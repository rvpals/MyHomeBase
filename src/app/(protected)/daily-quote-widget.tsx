"use client";

// One-off home-screen widget (not a registered shared component). The server
// picks the first quote; the refresh button draws another without reloading the
// page, so only the quote changes.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { DailyQuote } from "@/lib/daily-quote";
import { drawRandomQuoteAction } from "./daily-quote-actions";

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function DailyQuoteWidget({
  initialQuote,
  isAdmin,
  className,
}: {
  initialQuote: DailyQuote;
  isAdmin?: boolean;
  /** Spacing is the caller's call — the widget's position on the page moved once already. */
  className?: string;
}) {
  const [quote, setQuote] = useState(initialQuote);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleRefresh() {
    setIsDrawing(true);
    setError(undefined);
    try {
      const result = await drawRandomQuoteAction();
      if (!result.ok || !result.quote) {
        setError(result.error ?? "Failed to draw a quote.");
        return;
      }
      setQuote(result.quote);
    } finally {
      setIsDrawing(false);
    }
  }

  return (
    // Collapsed by default — the quote is a grace note, so it shouldn't push the
    // module carousel down the page. The two actions live in `headerAction` so
    // they stay reachable (and don't toggle the card) while it's shut.
    <CollapsibleCard
      title="Daily Quote"
      className={className}
      headerAction={
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" variant="secondary" href="/admin/daily-quote">
              Quotes Editor
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={isDrawing}>
            <RefreshIcon className={`h-4 w-4 ${isDrawing ? "animate-spin" : ""}`} />
            {/* Icon-only control, so the accessible name comes from this label. */}
            <span className="sr-only">Draw a new quote</span>
          </Button>
        </div>
      }
    >
      <figure>
        <blockquote className="font-display text-xl italic leading-relaxed text-ink">
          &ldquo;{quote.quote}&rdquo;
        </blockquote>

        <figcaption className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted">— {quote.author}</span>
          <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
            {quote.category}
          </span>
        </figcaption>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </figure>
    </CollapsibleCard>
  );
}
