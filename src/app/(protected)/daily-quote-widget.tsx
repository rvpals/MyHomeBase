"use client";

// One-off home-screen widget (not a registered shared component). The server
// picks the first quote; the refresh button draws another without reloading the
// page, so only the quote changes.

import { useState } from "react";
import { Button } from "@/components/button";
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

export function DailyQuoteWidget({ initialQuote }: { initialQuote: DailyQuote }) {
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
    <figure className="mt-6 rounded-lg border border-line bg-paper-raised p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
          Daily Quote
        </p>
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={isDrawing}>
          <RefreshIcon className={`h-4 w-4 ${isDrawing ? "animate-spin" : ""}`} />
          {/* Icon-only control, so the accessible name comes from this label. */}
          <span className="sr-only">Draw a new quote</span>
        </Button>
      </div>

      <blockquote className="mt-3 font-display text-xl italic leading-relaxed text-ink">
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
  );
}
