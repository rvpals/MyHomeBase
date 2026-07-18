/** Converts a decimal dollar amount (string or number) to integer cents. Throws on non-finite input. */
export function dollarsToCents(dollars: string | number): number {
  const parsed = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid dollar amount: "${dollars}"`);
  }
  return Math.round(parsed * 100);
}

/** Converts integer cents to a decimal dollar amount. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** Formats integer cents as a USD currency string, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    centsToDollars(cents),
  );
}
