// Small pieces shared across the Expense sections. Kept here rather than in one
// of the section views so importing a helper never drags a whole screen with it.

import type { CreditCardAccount } from "@/lib/expense";

/** Cents to a signed currency string, e.g. -4500 → "-$45.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${(absolute / 100).toFixed(2)}`;
}

/** Today's date as YYYY-MM-DD in local time (not UTC, which can be the wrong day). */
export function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The small card image, or nothing when the account has none. The bytes come
 * from the image route rather than the page payload; `updatedAt` is appended as
 * a cache-buster so a replaced image appears immediately.
 */
export function CardThumbnail({
  account,
  className = "",
}: {
  account: CreditCardAccount;
  className?: string;
}) {
  if (!account.imageMimeType) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- card image bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={`/api/expense/accounts/${account.id}/image?v=${encodeURIComponent(account.updatedAt)}`}
      alt=""
      className={`h-6 w-9 shrink-0 rounded border border-line object-cover ${className}`}
    />
  );
}
