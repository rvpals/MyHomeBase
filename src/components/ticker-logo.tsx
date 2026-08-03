// A ticker's logo, with the symbol's initials as a fallback. Pure presentation:
// it points at the logo route and shows the monogram if there's nothing to draw.
//
// Plenty of tickers — most ETFs, anything obscure — have no artwork at all, so
// the fallback is the normal case rather than an error state. The image is only
// swapped in once it loads, which avoids a broken-image flash.

"use client";

import { useState } from "react";

export interface TickerLogoProps {
  ticker: string;
  /** Pixel size of the square. Defaults to 24. */
  size?: number;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function TickerLogo({ ticker, size = 24, className = "" }: TickerLogoProps) {
  const [failed, setFailed] = useState(false);
  const symbol = ticker.trim().toUpperCase();

  // Two characters read better than one for the mix of symbols in a portfolio.
  const monogram = symbol.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "?";

  const boxStyle = { width: size, height: size };
  const shared = `shrink-0 rounded-md border border-line ${className}`;

  if (failed) {
    return (
      <span
        style={boxStyle}
        aria-hidden="true"
        title={symbol}
        className={`${shared} grid place-items-center bg-brass-soft font-mono text-[10px] font-semibold leading-none text-brass-dark`}
      >
        {monogram}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- logo bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={`/api/stocks/tickers/${encodeURIComponent(symbol)}/logo`}
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
