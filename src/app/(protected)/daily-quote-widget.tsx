"use client";

// One-off home-screen widget (not a registered shared component). The server
// picks the first quote; the refresh button draws another without reloading the
// page, so only the quote changes.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
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

// Resolved once at module scope. `getIconSlot` reads the static registry — no I/O — and
// the guard is for the registry, not the user: if this id is ever removed the card loses
// its icon rather than crashing.
const QUOTE_SLOT = getIconSlot("homescreen_card_daily_quote");

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
      // A slot, not a bare concept: this card is the first place whose icon an admin can
      // replace from Admin > Display Settings > Icons. With nothing uploaded it renders the
      // active set's quote-marks glyph, exactly as it did before.
      titleIcon={QUOTE_SLOT ? <SlotIcon slot={QUOTE_SLOT} className="h-4 w-4" /> : undefined}
      // `paper-texture` makes the card read as a physical sheet under the
      // handwriting — the sanctioned use of the class (see design.md > Type and
      // the surface-treatment rules). Composed with, not replacing, the caller's
      // `className`: that carries the widget's spacing on the dashboard.
      className={`paper-texture ${className ?? ""}`}
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
        {/* Copperplate script (`font-script`), not the theme display face — the
            quote is the one piece of decorative type in the app. No `italic`:
            Great Vibes already slants, and italicising a script face double-
            slants it. The quote marks are gone too; the calligraphy reads as a
            quotation on its own. Sized down narrow because script is markedly
            less legible small. */}
        <blockquote className="font-script text-3xl leading-snug text-ink max-lg:text-2xl">
          {quote.quote}
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
