// A flat side-on silhouette of one of the five Battleship ships.
//
// Pure presentation: the kind arrives as a prop and the drawing is a handful of SVG
// shapes. Everything is filled with `currentColor`, so the colour comes from the caller's
// theme-token text class (`text-ink`, `text-muted`, `text-brass`) and follows the theme.
//
// Every ship is drawn bow-to-the-right on the same 120x28 canvas with the waterline at
// y=24, so they sit on a common line when shown side by side. The width is the caller's
// (`className="w-16"`); the height follows from the viewBox.

import { type ReactNode } from "react";

export type ShipPictureKind = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";

export interface ShipPictureProps {
  /** Which ship to draw. */
  kind: ShipPictureKind;
  /**
   * Accessible name. Omit it when the ship's name is printed next to the picture — the
   * picture is then decoration and is hidden from screen readers.
   */
  label?: string;
  /** Caller-supplied classes, merged last so they win. Set the width and colour here. */
  className?: string;
}

const SHIPS: Record<ShipPictureKind, ReactNode> = {
  carrier: (
    <>
      {/* Hull and the long flight deck. */}
      <path d="M2 15h114l-6 9H9z" />
      {/* Island, mast and radar. */}
      <path d="M78 15V8h9v7z" />
      <path d="M82 8V3h1.6v5z" />
      <path d="M79 5h7v1.4h-7z" />
      {/* Two parked aircraft. */}
      <path d="M24 15v-2.6h8V15zM40 15v-2.6h8V15z" />
    </>
  ),
  battleship: (
    <>
      <path d="M2 16h110l6-3-6 11H8z" />
      {/* Forward and aft turrets with their guns. */}
      <path d="M86 16v-4h12v4zM98 13.2h8v1.2h-8z" />
      <path d="M24 16v-4h12v4zM14 13.2h10v1.2H14z" />
      {/* Bridge tower, funnel and mast. */}
      <path d="M52 16v-6h14v6z" />
      <path d="M56 10V4h6v6z" />
      <path d="M58.6 4V0.5h1v3.5z" />
      <path d="M70 16v-4h5v4z" />
    </>
  ),
  cruiser: (
    <>
      <path d="M4 17h92l6-3.5L96 24H10z" />
      <path d="M72 17v-3.6h10V17zM82 14.4h7v1.1h-7z" />
      <path d="M26 17v-3.6h10V17zM19 14.4h7v1.1h-7z" />
      <path d="M44 17V9h12v8z" />
      <path d="M48 9V4h4v5z" />
      <path d="M49.6 4V1h0.9v3z" />
    </>
  ),
  submarine: (
    <>
      {/* Round hull, conning tower, periscope and stern fin. */}
      <path d="M4 18c0-4 6-6 18-6h66c14 0 24 3 24 6s-10 6-24 6H22C10 24 4 22 4 18z" />
      <path d="M50 12V6.5h14V12z" />
      <path d="M62 6.5V2.5h1.4v4zM62 2.5h5.4v1.2H62z" />
      <path d="M6 18 1 12.5h4.6L10 17zM6 18l-5 5.5h4.6L10 19z" />
    </>
  ),
  destroyer: (
    <>
      {/* Low, narrow and quick: a sharp bow and a single gun forward. */}
      <path d="M6 18h92l16-4-9 10H14z" />
      <path d="M78 18v-3h10v3zM88 15.6h6v1H88z" />
      <path d="M46 18v-6h12v6z" />
      <path d="M50 12V7h4v5z" />
      <path d="M30 18v-4h6v4z" />
    </>
  ),
};

export function ShipPicture({ kind, label, className = "" }: ShipPictureProps) {
  return (
    <svg
      viewBox="0 0 120 28"
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`h-auto w-14 shrink-0 ${className}`}
    >
      {SHIPS[kind]}
    </svg>
  );
}
