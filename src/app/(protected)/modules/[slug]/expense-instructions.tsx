// Static reference for the Expense module — how the pieces fit together and the
// behaviours that aren't obvious from the UI (sign convention, duplicate
// detection, how rules decide). Pure content, no state; rendered inside a
// collapsed CollapsibleCard so it's there when wanted and out of the way when not.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs text-brass-dark">{children}</code>;
}

export function ExpenseInstructions() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        This module tracks credit-card spending: you add cards, import statements (or type
        transactions by hand), and categorise them — with rules doing most of the categorising for
        you.
      </p>

      <Section title="Getting started, in order">
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>
            Open <strong className="text-ink">Cards &amp; categories</strong> and add a credit-card
            account. Every transaction belongs to one, so nothing else works until a card exists.
          </li>
          <li>
            Optionally add a few <strong className="text-ink">categories</strong>. You don&apos;t have
            to — any new name you type on a transaction or a rule is created automatically.
          </li>
          <li>
            Add <strong className="text-ink">rules</strong> for the vendors you see often, so
            imported rows arrive already categorised.
          </li>
          <li>
            Use <strong className="text-ink">Import a statement</strong> to bring in a CSV, or{" "}
            <strong className="text-ink">Add a transaction</strong> to enter one by hand.
          </li>
        </ol>
      </Section>

      <Section title="Transactions">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Transaction date</strong> is when the purchase happened;{" "}
            <strong className="text-ink">posting date</strong> is when the card posted it. The
            posting date is optional — plenty of statements don&apos;t include one.
          </li>
          <li>
            <strong className="text-ink">Description</strong> is the raw vendor text from the
            statement, e.g. <Code>AMAZON MKTPL*2X4Y9</Code>. It&apos;s kept exactly as the card
            company wrote it, because that&apos;s what the rules match against.
          </li>
          <li>
            <strong className="text-ink">Amount</strong>: charges are positive, refunds and payments
            are negative. Enter <Code>20.33</Code> for a purchase and <Code>-45.00</Code> for a
            refund. Amounts are stored to the cent, never as rounded decimals.
          </li>
          <li>
            <strong className="text-ink">Category</strong>: exactly one per transaction. Leave it
            blank to deal with it later — blank shows as{" "}
            <span className="italic">uncategorised</span> and is what rules look for.
          </li>
          <li>
            <strong className="text-ink">Status</strong>: <Code>new</Code> (default, not yet
            checked), <Code>reconciled</Code> (matched against your statement), or{" "}
            <Code>irreconcilable</Code> (something doesn&apos;t line up and needs attention).
          </li>
          <li>
            <strong className="text-ink">Note</strong> is yours to fill in afterwards — the importer
            never writes to it.
          </li>
        </ul>
      </Section>

      <Section title="Auto-categorise rules">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            A rule says: <em>when the description matches this pattern, use this category</em> — and
            optionally set a status too. For example <Code>AMAZON*</Code> →{" "}
            <Code>online-purchase</Code>, status <Code>reconciled</Code>.
          </li>
          <li>
            <Code>*</Code> means &ldquo;anything&rdquo;. <Code>AMAZON*</Code> matches descriptions
            starting with AMAZON; <Code>*UBER*</Code> matches UBER anywhere. A pattern with no{" "}
            <Code>*</Code> matches anywhere by default, so <Code>COSTCO</Code> behaves like{" "}
            <Code>*COSTCO*</Code>.
          </li>
          <li>
            Matching ignores case, and every other character is literal — the <Code>*</Code>,{" "}
            <Code>#</Code> and brackets that litter card descriptions are treated as plain text.
          </li>
          <li>
            <strong className="text-ink">Priority</strong> decides who wins when several rules match:
            lowest number first. Put specific patterns above general ones, e.g.{" "}
            <Code>AMAZON PRIME*</Code> (priority 0) before <Code>AMAZON*</Code> (priority 10).
          </li>
          <li>
            Rules only fill in a <strong className="text-ink">blank</strong> category. They never
            overwrite a category you chose, so running them repeatedly is safe.
          </li>
          <li>
            <strong className="text-ink">Test this pattern</strong> tells you how many existing
            transactions a pattern would catch, before you save it.{" "}
            <strong className="text-ink">Apply rules now</strong> runs every enabled rule over the
            transactions you already have — useful after adding a rule, to backfill older rows.
          </li>
        </ul>
      </Section>

      <Section title="Importing a statement">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Every card company formats its export differently, so you map the columns once and{" "}
            <strong className="text-ink">save the mapping under that company&apos;s name</strong>{" "}
            (&ldquo;Chase Sapphire&rdquo;). Next time, pick it from the dropdown — you can also
            update or delete a saved mapping.
          </li>
          <li>
            Map each column to a field, or leave it as <em>Ignore</em>. Date columns get a{" "}
            <strong className="text-ink">format box</strong> — enter the shape your statement uses,
            e.g. <Code>MM/DD/YYYY</Code> or <Code>YYYY-MM-DD</Code>.
          </li>
          <li>
            If the statement has one amount column, map it to{" "}
            <strong className="text-ink">Amount</strong>. If it splits charges and credits into two
            columns, map them to <strong className="text-ink">debit</strong> and{" "}
            <strong className="text-ink">credit</strong> instead.
          </li>
          <li>
            Amounts like <Code>$20.33</Code>, <Code>1,234.56</Code>, <Code>(45.00)</Code> and{" "}
            <Code>45.00-</Code> are all understood; the last two count as negative.
          </li>
          <li>
            <strong className="text-ink">Flip the sign</strong> if your card writes purchases as
            negative — this module&apos;s convention is charges positive.
          </li>
          <li>
            <strong className="text-ink">Skip rows already imported</strong> compares card, date,
            description and amount, so re-importing an overlapping statement won&apos;t duplicate
            anything. The summary reports how many were skipped for that reason.
          </li>
          <li>
            Nothing is imported silently: the summary shows how many rows were imported, skipped
            (with the reason for each) and auto-categorised.
          </li>
        </ul>
      </Section>

      <Section title="Cards and categories">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            A card records a name, description and credit line. Deleting one is{" "}
            <strong className="text-ink">refused while transactions still reference it</strong>, so
            rows can never be orphaned from the statement they came from.
          </li>
          <li>
            <strong className="text-ink">Add image</strong> attaches a small picture — card art or
            the issuer&apos;s logo — shown beside the card everywhere it appears, including the
            Account column of the grid, so cards are easy to tell apart. PNG, JPEG, WebP or GIF, up
            to 512&nbsp;KB.
          </li>
          <li>
            Deleting a category <strong className="text-ink">keeps the transactions</strong> — they
            simply become uncategorised again.
          </li>
        </ul>
      </Section>

      <Section title="The transactions grid">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Search across every column, or open <strong className="text-ink">Filters</strong> for
            per-column filtering. Click a header to sort.
          </li>
          <li>
            <strong className="text-ink">Columns</strong> lets you hide and reorder columns; your
            arrangement is remembered on this device.
          </li>
          <li>
            <strong className="text-ink">Export CSV</strong> exports what you&apos;re currently
            looking at — filters and sort included, across all pages.
          </li>
        </ul>
      </Section>
    </div>
  );
}
