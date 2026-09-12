# Export for AI Analysis

Packages the Stocks & ETFs portfolio into a prompt you can paste into any LLM —
holdings, weights, cost basis and returns, behind an analyst brief that tells the
model what the numbers mean and what is deliberately missing.

Built 2026-09-11. No migration, no new table, no third-party service, nothing paid.

---

## Where it lives

| Path | What it does |
|---|---|
| [src/lib/portfolio-export/types.ts](src/lib/portfolio-export/types.ts) | Domain shapes: `ExportHolding`, `ExportSummary`, `AccountKind`, `AnalysisFocus` |
| [src/lib/portfolio-export/account-kind.ts](src/lib/portfolio-export/account-kind.ts) | Infers tax treatment from the account name; anonymises the label |
| [src/lib/portfolio-export/portfolio-export.ts](src/lib/portfolio-export/portfolio-export.ts) | `classifyAccounts`, `aggregateHoldings`, `summarize`, `buildPortfolioExport` |
| [src/lib/portfolio-export/prompt.ts](src/lib/portfolio-export/prompt.ts) | The analyst brief — role, context, per-focus instructions, output shape |
| [src/lib/portfolio-export/render.ts](src/lib/portfolio-export/render.ts) | Markdown and JSON renderings, plus the download filename |
| [src/lib/portfolio-export/schema.ts](src/lib/portfolio-export/schema.ts) | `portfolioExportOptionsSchema` — the boundary both adapters parse with |
| [src/app/(protected)/modules/[slug]/stock-ai-export-view.tsx](src/app/(protected)/modules/[slug]/stock-ai-export-view.tsx) | The screen: card, modal, toggles, preview, copy, download |
| [src/app/(protected)/modules/[slug]/stock-ai-export-actions.ts](src/app/(protected)/modules/[slug]/stock-ai-export-actions.ts) | One server action, authorised on its first line |
| [src/cli/export-portfolio.ts](src/cli/export-portfolio.ts) | The same use-case from a terminal |

Tests: [portfolio-export.test.ts](src/lib/portfolio-export/portfolio-export.test.ts)
(39) and [render.test.ts](src/lib/portfolio-export/render.test.ts) (21) — 60 in all.

Also touched: `stock-sections.ts` (new section), `stock-section.tsx` (the case plus
the dashboard's "Export for AI" button), `slots.ts` / `slots.test.ts` (the icon
slot), `modules.md`.

---

## How to use it

**Web.** Stocks & ETFs → *Export for AI Analysis* in the section panel, or the
**Export for AI** button on the Dashboard heading. Pick Markdown or JSON, tick the
focus areas, read the preview, then **Copy to clipboard** or **Download**.

**CLI.**

```bash
npm run cli -- export-portfolio                      # Markdown, all three focuses
npm run cli -- export-portfolio --format json        # structured
npm run cli -- export-portfolio --focus fees,tax     # two of the three
npm run cli -- export-portfolio --kinds "Roth IRA"   # one account type
npm run cli -- export-portfolio --format json > portfolio.json
```

Both paths call `buildPortfolioExport` with the same schema-validated options, so
they produce identical text.

---

## What the export contains

**Summary** — total market value, total cost basis, unrealised gain/loss ($ and %),
position and account counts, cash allocation %, top 3 sectors, and a per-account-type
breakdown.

**Holdings** — one row per ticker, aggregated across accounts: name, vehicle type,
which account types hold it, quantity, average cost basis, current price, market
value, unrealised gain/loss ($ and %), portfolio weight %, sector, expense ratio.

**Excluded accounts** — what was left out and why, so the model cannot mistake an
omission for an absence.

**The prompt** — role, context and caveats, the selected analyses, and the requested
answer format.

---

## The decisions, and why

### Account type is inferred, never stored

`stk_investment_accounts` has no `account_type` column. Adding one meant a migration
plus an admin field to keep current; the names already carry the answer. So
`inferAccountKind` reads the name:

| Pattern | Kind | Exported by default |
|---|---|---|
| `ROTH` | Roth IRA | yes |
| `TRADITIONAL IRA`, `ROLLOVER IRA`, `SEP IRA`, `SIMPLE IRA` | Traditional IRA | yes |
| `401K`, `403B`, `457B`, `PENSION`, `VOYA` | Retirement | no |
| `HEALTH SAVING`, `HSA` | HSA | no |
| anything else | Taxable | yes |

Order matters: `ROTH` is tested first, so a *Roth 401k* reads as a Roth — its
tax-free withdrawals are the whole point of the placement analysis.

Verified against all seven live accounts; the inference reproduces the owner's own
classification exactly. **Hard-coding account ids was rejected** — it would rot the
moment an account is added or renumbered.

### Only accounts with real holdings are exported

Of seven accounts, four hold a balance but **no positions** — the 401K, both VOYA
plans and the HSA, about $1.11M. Including them would contribute an opaque number
that no allocation, overlap or fee analysis can act on, while making the total look
like it covers everything. They are excluded and *named as excluded*, and the prompt
says outright: *"The owner DOES have retirement savings outside what you can see."*

### Account names never leave the machine

The real names carry institutions (Chase, Fidelity, VOYA) and employers (Rutgers,
TCNJ). The payload replaces each with its tax treatment — `Taxable Account 1`,
`Taxable Account 2`, `Roth IRA`. The tax treatment is the only part the analysis
needs.

**Security names are deliberately untouched.** The portfolio holds JPM — "JP Morgan
Chase & Co." — whose name contains the same word as account 1's broker. A blanket
string scrub would corrupt a legitimate holding. Sanitisation removes *account*
names, not securities, and a test pins that distinction.

### Missing data is `null`, never `0`

A position with no cost basis reports `averageCostBasis: null` and a null
gain/loss — not zero, which would read as "bought for free" and silently drag the
portfolio return upward. Markdown renders these as `—`. The summary excludes them
from both sides of the return so the percentage compares like with like, and the
prompt states how many there are.

### Expense ratios are `null` everywhere

Nothing in the app tracks one and no free provider is wired up. Rather than drop the
Fee Drag analysis, the field is emitted as `null` and the prompt instructs the model
to supply ratios from its own knowledge **and flag them as unverified**. Inventing a
number the model would then reason about is worse than admitting the gap.

### Holdings aggregate by ticker, across accounts

The questions being asked — how concentrated am I, do these funds overlap — are
about the portfolio, not the brokerage. MSFT and TSLA are each held in two accounts;
each becomes one row whose `accounts` field lists both, which is what the tax
placement analysis reads. Cost basis is summed in cents and divided once at the end,
so a blended average is correct rather than the mean of two averages.

---

## The prompt

Four blocks, assembled by `buildAnalystPrompt`:

1. **Role** — analyst framing, the standing rule to ground claims in the supplied
   numbers and flag outside knowledge, and the portfolio's headline size and date.
2. **Context** — excluded accounts, the expense-ratio gap, how many holdings lack a
   sector or a basis, and why account names are categories. Each line appears only
   when it applies.
3. **What to analyse** — the ticked focus areas, always in canonical order so the
   same selection produces byte-identical text. Nothing ticked asks for a general
   review instead.
4. **How to answer** — lead with the three findings that matter most, cite tickers
   and figures, close with a prioritised action list marking which actions carry a
   tax consequence.

The three focus areas:

| Focus | Asks for |
|---|---|
| Asset Allocation & Overlap | Positions >5%, sectors >30%, fund/equity overlap and true combined exposure, what's missing (geography, market cap, bonds) |
| Fee Drag & Expense Ratios | Per-fund ratios, annual cost in dollars, cheaper equivalents — and honesty when a switch saves trivially little or triggers a gain |
| Tax Efficiency & Rebalancing | Placement by account type, positions with large gains, rebalancing routes that avoid realising them |

---

## Edge cases handled

| Case | Behaviour |
|---|---|
| Zero-balance / zero-quantity holding | Kept, weight 0%, no division by zero |
| Missing cost basis | `null` gain/loss; excluded from return totals; counted in the prompt |
| Basis on some accounts only | Average taken over the shares that reported one |
| Unclassified sector | `Unclassified`; funds show `ETFs & funds`; count stated in the prompt |
| Same ticker, two accounts | One row, both account types, blended basis, price not summed |
| Ticker case mismatch | Matched case-insensitively, reported upper-case |
| Blank security name | Falls back to the ticker |
| Pipe in a fund name | Escaped so the Markdown table can't break |
| Empty portfolio | `_No holdings in the exported accounts._`, zeroes not NaN |
| Three identical exclusions | Grouped to one line with a count |
| Clipboard permission denied | Silent; the text is on screen and selectable |

---

## Live figures (as of the 2026-08-05 valuation)

| | |
|---|---|
| Exported | $586,251.46 across 49 positions, 3 accounts |
| Taxable | $579,486.38 (98.85%) |
| Roth IRA | $6,765.08 (1.15%) |
| Unrealised gain | $187,500.30 (+47.02%) |
| Top sector | Technology, $237,802.58 (40.56%) |
| No sector | 11 of 49 holdings |
| Excluded | 3 retirement plans + 1 HSA |

The Technology concentration at 40.6% and NVDA alone at 16.5% are exactly what the
allocation focus is built to surface.

---

## Architecture notes

- All logic is in `src/lib/portfolio-export/`; the view and the CLI only present.
  No `react`/`next` import under `lib` (boundary check passes).
- The server action authorises on its first line with
  `requireModuleAccess("stock-etfs")` — the module's full slug, matched exactly.
  It is read-only, so it revalidates nothing.
- The icon slot is **`stock_section_ai_export`**, derived from
  `sectionSlotId("stock", "ai-export")`. The id is persisted in
  `ico_slot_overrides.slot_id`: renaming it, or the `ai-export` section slug,
  orphans any uploaded icon. `slots.test.ts` enumerates it. (Registering the slot
  also closed a pre-existing gap — `tax-lots` was missing from that list.)
- Responsive via `max-lg:` only: stat tiles collapse to one column, the preview
  shortens. No desktop class changes, so wide screens can't regress.
- No new shared component. `Modal`, `Button` and `CollapsibleCard` already covered
  it, so `components.md` needed no entry.

## If you want to change something

- **Keep real account names** — drop the `sanitizeAccountLabel` call in
  `classifyAccounts`. One line.
- **Include the HSA** — add `"HSA"` to `DEFAULT_EXPORTED_KINDS`, or pass
  `--kinds` / the UI's kind list at call time. No code change needed for a one-off.
- **A new account type** — extend `KIND_PATTERNS` in `account-kind.ts`. Do not
  special-case an id.
- **Real expense ratios** — populate `ExportHolding.expenseRatio` in
  `aggregateHoldings` and delete the caveat line in `prompt.ts`. The field and the
  column already exist end to end.
- **A fourth focus area** — add it to `AnalysisFocus`, `ANALYSIS_FOCUS_INFO` and
  `FOCUS_INSTRUCTIONS`; the checklist and the ordering follow automatically.

## Verification

Typecheck clean for every file in this feature; lint clean; library boundary clean;
60 new unit tests plus the full suite at 3,822 passing across 157 files. The CLI was
run against a copy of the live NAS database — never the real file — and its figures
were cross-checked against direct SQL.

Five typecheck errors remain in `src/lib/journal/*`, from separate uncommitted work
on that module (`externalContent` added to the type without updating its test
fixtures). They predate this feature and are untouched by it.

Per-project convention, the browser sweep was not run — Min tests the UI himself.
