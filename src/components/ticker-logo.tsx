// A ticker's logo, with the symbol's initials as a fallback. Pure presentation:
// it points at the logo route and shows the monogram if there's nothing to draw.
//
// Plenty of tickers — most ETFs, anything obscure — have no artwork at all, so
// the fallback is the normal case rather than an error state. The image is only
// swapped in once it loads, which avoids a broken-image flash.
//
// The market indexes reuse this through `IndexLogo` below: same box, same
// fallback behaviour, different route. Worth one component rather than two
// near-copies, since "artwork that usually isn't there" is the whole design.

"use client";

import { useState } from "react";

/** Two characters read better than one for the mix of symbols in a portfolio. */
function monogramFor(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2) || "?";
}

interface LogoBoxProps {
  /** Where the bytes come from. A 404 is expected and shows the monogram. */
  src: string;
  /** Drawn when there's no image. Already trimmed to a couple of characters. */
  monogram: string;
  /** The full name, for the fallback's tooltip. */
  title: string;
  size: number;
  className: string;
}

/**
 * The shared box: an image that quietly becomes a monogram when it can't load.
 *
 * Keyed on `src` by the caller where the symbol can change in place, so a stale
 * `failed` from the previous symbol doesn't suppress the next one's image.
 */
function LogoBox({ src, monogram, title, size, className }: LogoBoxProps) {
  const [failed, setFailed] = useState(false);

  const boxStyle = { width: size, height: size };
  const shared = `shrink-0 rounded-md border border-line ${className}`;

  if (failed) {
    return (
      <span
        style={boxStyle}
        aria-hidden="true"
        title={title}
        className={`${shared} grid place-items-center bg-brass-soft font-mono text-[10px] font-semibold leading-none text-brass-dark`}
      >
        {monogram}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- logo bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={boxStyle}
      className={`${shared} bg-paper object-contain`}
    />
  );
}

export interface TickerLogoProps {
  ticker: string;
  /** Pixel size of the square. Defaults to 24. */
  size?: number;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function TickerLogo({ ticker, size = 24, className = "" }: TickerLogoProps) {
  const symbol = ticker.trim().toUpperCase();

  return (
    <LogoBox
      key={symbol}
      src={`/api/stocks/tickers/${encodeURIComponent(symbol)}/logo`}
      monogram={monogramFor(symbol)}
      title={symbol}
      size={size}
      className={className}
    />
  );
}

export interface IndexLogoProps {
  /** The catalogue symbol, e.g. `^GSPC`. Unknown ones 404 and show the monogram. */
  symbol: string;
  /**
   * The index's display name, used for the fallback's initials and tooltip.
   *
   * The label rather than the symbol, because `^GSPC` and `DX-Y.NYB` make
   * poor monograms — "S&" and "US" from "S&P 500" and "US Dollar Index" at
   * least resemble the row they sit against.
   */
  label: string;
  /** Pixel size of the square. Defaults to 20, the size the index board uses. */
  size?: number;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** A market index's icon — the mark of whoever publishes it. */
export function IndexLogo({ symbol, label, size = 20, className = "" }: IndexLogoProps) {
  return (
    <LogoBox
      key={symbol}
      src={`/api/stocks/indexes/${encodeURIComponent(symbol)}/logo`}
      monogram={monogramFor(label)}
      title={label}
      size={size}
      className={className}
    />
  );
}
