/**
 * Working out an account's tax treatment from its name, and stripping the name
 * itself out of the export.
 *
 * Inferred rather than stored because `stk_investment_accounts` has no type
 * column, and adding one would mean a migration plus an admin field to maintain
 * by hand. The names already say it — "Fidelity ROTH IRA Account", "Fidelity
 * 401K", "VOYA TCNJ" — so the rules below read what is there. Verified against
 * every account in the live database: the seven rows classify exactly as their owner
 * classifies them.
 *
 * If the inference is ever wrong for a new account, the fix is to rename the
 * account or extend one list here — not to special-case an id, which would rot
 * the moment accounts are renumbered.
 */

import type { AccountKind } from "./types";

/**
 * Order matters: the first match wins.
 *
 * "Roth" is tested before the retirement-plan words because a "Roth 401k" is
 * meaningfully a Roth — its withdrawals are tax-free, which is the whole point
 * of the placement analysis — and testing 401k first would bury that.
 */
const KIND_PATTERNS: ReadonlyArray<{ kind: AccountKind; patterns: readonly string[] }> = [
  { kind: "Roth IRA", patterns: ["ROTH"] },
  { kind: "HSA", patterns: ["HEALTH SAVING", "HEALTH-SAVING", "HSA"] },
  { kind: "Traditional IRA", patterns: ["TRADITIONAL IRA", "ROLLOVER IRA", "SEP IRA", "SIMPLE IRA"] },
  {
    kind: "Retirement",
    // VOYA is here because in this database it is the employer plan provider;
    // it is a provider name rather than a plan type, so it sits last in the list
    // where the explicit plan words can win first.
    patterns: ["401K", "401(K)", "403B", "403(B)", "457B", "457(B)", "PENSION", "VOYA"],
  },
];

/**
 * An account's tax treatment. Anything that matches nothing is `Taxable` —
 * the safe default, since an ordinary brokerage account is the one kind whose
 * name carries no marker at all ("Chase Joint Stock Account").
 */
export function inferAccountKind(accountName: string): AccountKind {
  const upper = accountName.toUpperCase();
  for (const { kind, patterns } of KIND_PATTERNS) {
    if (patterns.some((pattern) => upper.includes(pattern))) return kind;
  }
  return "Taxable";
}

/** Why a kind is left out, phrased for the reader of the export. */
export function exclusionReason(kind: AccountKind): string {
  if (kind === "HSA") {
    return "Health savings account — tracked as a balance, with no individual holdings recorded.";
  }
  return "Employer retirement plan — tracked as a balance, with no individual holdings recorded.";
}

/**
 * A stable, anonymous label for an account.
 *
 * The real names carry an institution ("Chase", "Fidelity") and sometimes an
 * employer ("VOYA Rutgers", "VOYA TCNJ"), none of which the analysis needs and
 * all of which identify the owner to whatever service the text is pasted into.
 * The tax treatment is the useful part, so that is what the label is.
 *
 * `ordinal` disambiguates two accounts of the same kind — the caller counts them
 * in a stable order so "Taxable Account 1" means the same account across two
 * exports taken the same day. A lone account of its kind gets no number, which
 * reads better and is unambiguous by definition.
 */
export function sanitizeAccountLabel(kind: AccountKind, ordinal: number, totalOfKind: number): string {
  const base = kind === "Taxable" ? "Taxable Account" : kind;
  return totalOfKind > 1 ? `${base} ${ordinal}` : base;
}
