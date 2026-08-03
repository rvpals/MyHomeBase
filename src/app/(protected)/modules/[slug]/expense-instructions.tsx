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

      <Section title="How this module is laid out">
        <p>Use the tree on the left. Each section does one job:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Main (Dashboard)</strong> — the headline numbers and your
            biggest categories. The counters link through to wherever the work is.
          </li>
          <li>
            <strong className="text-ink">Transactions</strong> — the full list, plus the form for
            adding or editing one by hand.
          </li>
          <li>
            <strong className="text-ink">Meta Data</strong> — the credit cards and categories that
            everything else refers to. Set a card up here first.
          </li>
          <li>
            <strong className="text-ink">Charts and Analysis</strong> — spend by category, as a chart
            and a table.
          </li>
          <li>
            <strong className="text-ink">Import Transaction</strong> — bring in a statement CSV, and
            manage the Post Import Processing rules and clean-up run that tidy it up.
          </li>
          <li>
            <strong className="text-ink">Settings</strong> — the folder to watch for automatic
            imports, and how often to check it.
          </li>
        </ul>
        <p>Each section is its own page, so you can bookmark or link to any of them.</p>
      </Section>

      <Section title="Getting started, in order">
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>
            Open <strong className="text-ink">Meta Data</strong> and add a credit-card
            account. Every transaction belongs to one, so nothing else works until a card exists.
          </li>
          <li>
            Optionally add a few <strong className="text-ink">categories</strong>. You don&apos;t have
            to — any new name you type on a transaction or a rule is created automatically.
          </li>
          <li>
            Under <strong className="text-ink">Post Import Processing</strong>, add rules for the
            vendors you see often — each rule can fill in several fields at once, so imported rows
            arrive with a tidy vendor name and a category already set.
          </li>
          <li>
            Use <strong className="text-ink">Import Transaction</strong> to bring in a CSV, or add
            one by hand under <strong className="text-ink">Transactions</strong>.
          </li>
          <li>
            Run <strong className="text-ink">Manually Run Import Clean up</strong> to put anything
            still waiting through the rules.
          </li>
        </ol>
      </Section>

      <Section title="The four counters at the top">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Total</strong> — the sum of every transaction shown
            (charges positive, refunds negative).
          </li>
          <li>
            <strong className="text-ink">To processed</strong> — rows the post-import rules
            haven&apos;t run over yet. It goes up after an import and drops to zero after a clean-up
            run, and is highlighted while there&apos;s anything outstanding.
          </li>
          <li>
            <strong className="text-ink">Uncategorised</strong> — rows with no category. A row can be
            processed and still uncategorised, if no rule matched it.
          </li>
          <li>
            <strong className="text-ink">To reconcile</strong> — rows still on status{" "}
            <Code>new</Code>.
          </li>
        </ul>
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
            <strong className="text-ink">Vendor</strong> is the tidy name — <Code>TGI Friday</Code>{" "}
            rather than <Code>SQ *TGI FRIDAYS #221</Code>. Usually filled in for you by a rule, but
            you can type it yourself.
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
            <strong className="text-ink">Processed</strong> marks whether the post-import rules have
            been run over this row. Imported rows are marked processed as they arrive (the rules run
            during import); rows you type by hand start unprocessed and are picked up by the next
            clean-up.
          </li>
          <li>
            <strong className="text-ink">Note</strong> is yours to fill in afterwards — the importer
            never writes to it.
          </li>
        </ul>
      </Section>

      <Section title="Post Import Processing">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            A rule is <strong className="text-ink">one condition and any number of fields to
            set</strong>. For example <Code>*TGI*</Code> &rarr; Vendor = <Code>TGI Friday</Code>,
            Category = <Code>Restaurant</Code>. Use <strong className="text-ink">+ Add another
            field</strong> to set as many as you need — the fields available are Category, Vendor,
            Status and Note.
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
            <Code>AMAZON PRIME*</Code> (priority 0) before <Code>AMAZON*</Code> (priority 10). Only
            the first matching rule is applied.
          </li>
          <li>
            A rule only fills a field that is <strong className="text-ink">still blank</strong> — or,
            for status, still <Code>new</Code>. It never overwrites something you set yourself, which
            is what makes re-running safe.
          </li>
          <li>
            <strong className="text-ink">Test this pattern</strong> tells you how many existing
            transactions a pattern would catch, before you save it.
          </li>
          <li>
            <strong className="text-ink">Enabled</strong> lets you switch a rule off without deleting
            it.
          </li>
        </ul>
      </Section>

      <Section title="Running the clean-up">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Manually Run Import Clean up</strong> takes every
            transaction where <em>Processed</em> is no, runs the rules over it, and marks it
            processed. A progress bar and a log show each row as it goes:
            <span className="mt-1 block font-mono text-[11px] leading-5">
              Processing 41 of 216 — #883 SQ *TGI FRIDAYS #221 — rule &ldquo;*TGI*&rdquo; used,
              vendor set to &ldquo;TGI Friday&rdquo;, category set to &ldquo;Restaurant&rdquo;
            </span>
          </li>
          <li>
            It works in batches, so the progress is real rather than a guess, and the run is
            resumable — if you navigate away half way through, the rows already done stay done and
            the rest are picked up next time.
          </li>
          <li>
            Rows that <strong className="text-ink">no rule matched are still marked processed</strong>
            . They&apos;ve been through the rules, so they don&apos;t need looking at again; they
            simply stay uncategorised.
          </li>
          <li>
            <strong className="text-ink">Re-queue all</strong> clears every processed flag so the
            rules run over the whole history again. That&apos;s what to use after adding a rule that
            should reach older transactions. Values you already set are still never overwritten.
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

      <Section title="Automatic import (optional)">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Set a <strong className="text-ink">folder</strong> and an{" "}
            <strong className="text-ink">interval in minutes</strong> under &ldquo;Automatic CSV
            import&rdquo;, and the server imports statements on that timer. Set the interval to 0 to
            turn it off.
          </li>
          <li>
            Inside the folder, create <strong className="text-ink">one sub-folder per card, named
            after it</strong> — <Code>/csv_import/Visa Gold/</Code> imports into the{" "}
            <Code>Visa Gold</Code> account, using the saved mapping of the same name. Files inside
            can be named anything.
          </li>
          <li>
            Processed files are renamed to <Code>&lt;name&gt;_&lt;timestamp&gt;.backup</Code> in
            place; failures become <Code>.failed</Code> with the reason reported. Rename a{" "}
            <Code>.failed</Code> file back to <Code>.csv</Code> to retry it.
          </li>
          <li>
            Each run applies the rules and skips already-imported rows, and imports are attributed
            to the first administrator account.
          </li>
          <li>
            <strong className="text-ink">Run import now</strong> does the same pass immediately,
            which is the quickest way to check your folder layout is right.
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
            arrangement is remembered on this device. Alongside the usual fields there are{" "}
            <strong className="text-ink">Vendor</strong> and{" "}
            <strong className="text-ink">Processed</strong> columns — filter Processed to{" "}
            <Code>no</Code> to see exactly what the next clean-up will touch.
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
