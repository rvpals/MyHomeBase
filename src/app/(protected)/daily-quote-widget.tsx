"use client";

// One-off home-screen widget (not a registered shared component). The server
// picks the first quote; the refresh button draws another without reloading the
// page, so only the quote changes.
//
// WHY THIS ONE HAS NO CARD AROUND IT. Every other home widget is a
// `CollapsibleCard`; this one is a bare scroll on the page. A scroll is already
// a complete object with its own edges, and a card around it drew a second,
// squarer frame a few pixels outside the first — two borders describing the same
// thing. So the scroll *is* the container here. It is the only widget allowed to
// skip the card, on that reasoning; a widget whose content has no shape of its
// own still takes a card.
//
// The two things the card used to supply are not lost:
//   - **Close and rearrange** come from `HomeWidgetGrid`, which wraps every
//     widget in a draggable frame carrying a hover-revealed close button. That
//     works on any node, so dropping the card cost nothing here.
//   - **Collapse** is genuinely gone. It was only ever there to keep the quote
//     from pushing the carousel down the page, and the scroll is shorter than
//     the card it replaces.

import { useState } from "react";
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

function PencilIcon({ className = "" }: { className?: string }) {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// Resolved once at module scope. `getIconSlot` reads the static registry — no I/O — and
// the guard is for the registry, not the user: if this id is ever removed the card loses
// its icon rather than crashing.
const QUOTE_SLOT = getIconSlot("homescreen_card_daily_quote");

// A control sitting *on* the bottom dowel. Deliberately not `Button`: every
// variant carries a hard 4px offset shadow, and a raised switch standing off a
// curved surface reads as stuck to it rather than part of it. These are bare
// glyphs instead — the same treatment row actions already get (coding-guide.md,
// "Icons: use a slot, not a bare glyph name" exempts row actions and state
// glyphs), tinted with the roll's own lit edge so they sit in the wood.
const ROLL_CONTROL =
  "inline-flex items-center justify-center rounded-full p-1 text-[color:var(--ink)]/70 transition-colors hover:bg-[color:var(--edge-lit)]/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40 motion-reduce:transition-none";

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
    // An unrolled scroll: a rolled dowel, the hanging sheet, a second dowel that
    // doubles as the control bar. Styling lives in the `.scroll-*` hooks in
    // globals.css; the geometry (width, padding) stays here, where the widget
    // owns it — see design.md, "give decoration its own geometry-free hook".
    //
    // `paper-texture` is on the sheet rather than out here, so the grain stops at
    // the paper and doesn't run across the dowels.
    <div className={className}>
      {/* The top roll carries nothing, so it is pure decoration and hidden from
          assistive tech. The bottom one holds real controls and is not. */}
      <div className="scroll-roll" aria-hidden />

      <figure className="scroll-sheet paper-texture px-5 py-5 max-lg:px-4">
        {/* Copperplate script (`font-script`), not the theme display face — the
            quote is the one piece of decorative type in the app. No `italic`:
            Great Vibes already slants, and italicising a script face double-
            slants it. The quote marks are gone too; the calligraphy reads as a
            quotation on its own. Sized down narrow because script is markedly
            less legible small. Centred, because a sheet hung between two rolls
            reads as a proclamation and ragged-right fights that. */}
        <blockquote className="text-center font-script text-3xl leading-snug text-ink max-lg:text-2xl">
          {quote.quote}
        </blockquote>

        {/* Attribution stays on the paper — it is part of the quotation. The
            category moved down to the roll, because it labels the widget rather
            than the words. */}
        <figcaption className="mt-4 text-center text-sm font-medium text-muted">
          — {quote.author}
        </figcaption>

        {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
      </figure>

      {/*
        The bottom dowel, doing double duty as the widget's control bar.

        Standing chrome, unlike the grid's hover-revealed ✕ — and the difference is
        deliberate. Closing a card is an action taken once; drawing a new quote is
        the thing this widget is *for*, so hiding its only control behind a hover
        would bury the point. There is also nowhere else for it to go now that the
        card header is gone.

        `relative` with the roll's gradient underneath: the controls sit on the
        cylinder, so the row carries no surface of its own.
      */}
      <div className="scroll-roll scroll-roll-controls flex items-center gap-2 px-4 max-lg:px-3">
        {QUOTE_SLOT && <SlotIcon slot={QUOTE_SLOT} className="h-3.5 w-3.5 shrink-0 opacity-70" />}

        <span className="truncate text-xs font-semibold uppercase tracking-wide text-[color:var(--ink)]/70">
          {quote.category}
        </span>

        <div className="min-w-0 flex-1" />

        {isAdmin && (
          // An anchor, not `Button href` — see ROLL_CONTROL above for why these
          // aren't Buttons. `next/link` isn't needed for a one-off jump out to admin.
          <a
            href="/admin/daily-quote"
            className={ROLL_CONTROL}
            title="Quotes Editor"
            aria-label="Quotes Editor"
          >
            <PencilIcon className="h-4 w-4" />
          </a>
        )}

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isDrawing}
          className={ROLL_CONTROL}
          title="Draw a new quote"
          // Icon-only control, so the accessible name comes from here.
          aria-label="Draw a new quote"
        >
          <RefreshIcon className={`h-4 w-4 ${isDrawing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
