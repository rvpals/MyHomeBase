// Per-section reference for the Stocks & ETFs module — how the pieces fit
// together and the behaviours that aren't obvious from the UI (what "Unassigned"
// means, why a cost basis can read "—", how re-importing behaves).
//
// Each section shows only the part that applies to it; the dashboard carries the
// module-wide overview. Pure content, no state, rendered inside a collapsed
// CollapsibleCard so it's there when wanted and out of the way when not.

import type { StockSection } from "./stock-sections";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function MainInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        This module tracks what you hold, what you paid, and what it&apos;s worth. Positions can be
        typed in by hand or imported from a broker CSV; prices come from a live quote feed on demand.
      </p>
      <Section title="How this module is laid out">
        <p>Use the tree on the left. Each section does one job:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Dashboard</strong> — headline value, today&apos;s move,
            total return, allocation, and the day&apos;s biggest movers.
          </li>
          <li>
            <strong className="text-ink">Positions</strong> — every holding with its cost basis and
            gain, plus the form to add or edit one and the Refresh All button.
          </li>
          <li>
            <strong className="text-ink">Transactions</strong> — the buy/sell history. Kept separate
            from positions on purpose: a position is a current state, a transaction is a past event.
          </li>
          <li>
            <strong className="text-ink">Account Performance</strong> — your brokerage accounts and
            their total value over time.
          </li>
          <li>
            <strong className="text-ink">Actionables</strong> — watch lists, and the next-day scan
            that flags positions worth a decision.
          </li>
          <li>
            <strong className="text-ink">Chart &amp; Analysis</strong> — volatility, correlation and
            Sharpe ratio, computed from price history.
          </li>
          <li>
            <strong className="text-ink">CSV Import</strong> — define a column mapping per broker
            export, save it under that broker&apos;s name, and reuse it.
          </li>
          <li>
            <strong className="text-ink">Configuration</strong> — the thresholds the next-day scan
            uses.
          </li>
        </ul>
      </Section>
      <Section title="Search for a ticker">
        <p>
          The <strong className="text-ink">magnifier</strong> beside the Dashboard heading looks up a
          symbol without hunting for a row that holds it. Type any part of a ticker and it suggests
          matches from everything the app already knows — what you hold, what you&apos;re watching,
          and anything it has cached reference data for — tagged so you can tell which is which.
        </p>
        <p>
          A symbol we have <em>no</em> record of is still worth a look, so pressing{" "}
          <strong className="text-ink">Enter</strong> opens it anyway — on the{" "}
          <strong className="text-ink">Yahoo</strong> tab, since the Our-data cards would have
          nothing to show. Matching is on the symbol itself, not a company name: no company names are
          stored anywhere in the app.
        </p>
      </Section>
      <Section title="Favorites">
        <p>
          The <strong className="text-ink">star</strong> beside the magnifier lists the symbols
          you&apos;ve marked, newest first, each with its logo — click one to open its viewer. It
          answers the question a search box can&apos;t: not &ldquo;find me a symbol I can
          name&rdquo; but &ldquo;open one of the handful I check every morning.&rdquo;
        </p>
        <p>
          You mark one from <strong className="text-ink">inside the viewer</strong> — the star in
          its header, pressed once to favorite and again to unfavorite. That&apos;s the only place
          it lives, deliberately: every ticker in the app opens that dialog, so one control covers
          Positions, Transactions, watch lists and mover rows without a star in every grid.
        </p>
        <p>
          A favorite is just the symbol — no shares, no price, no reminder. That makes it
          different from a <strong className="text-ink">watch list</strong>, which tracks how a
          symbol has moved since you noticed it; the two are independent, and starring something
          never adds it to a list. Favorites are shared across everyone using the app, and
          nothing removes one automatically — sell the position and the star stays, because a
          symbol you&apos;ve exited is still one you may want to look at.
        </p>
      </Section>
      <Section title="Click a ticker for its full viewer">
        <p>
          Any <strong className="text-ink">ticker</strong> — in Positions, Transactions, a watch
          list, or a Daily Glance mover row — opens a dialog holding everything the app knows about
          that symbol. It is split into two groups, and the split is the point.
        </p>
        <p>
          <strong className="text-ink">Our data</strong> is what MyHomeBase recorded:{" "}
          <strong className="text-ink">Holdings</strong> (the position in each account, with the
          totals across them), <strong className="text-ink">Transactions</strong> (the trade history
          for that symbol, with the weighted average buy price), and{" "}
          <strong className="text-ink">Watchlist &amp; income</strong> (dividend rate, yield on cost,
          and how far the price has drifted since you added it to a list).
        </p>
        <p>
          The Transactions tab also carries{" "}
          <strong className="text-ink">My past performance</strong> — every trade plotted against
          the market&apos;s closing price on the trading day either side of it, ending at the
          latest close, so you can see whether a fill was a good one. Weekends and holidays are
          skipped, so &ldquo;day before&rdquo; means the previous <em>trading</em> day.
        </p>
        <p>
          <strong className="text-ink">Every point is shaped by what it is</strong> — an
          upward triangle for a buy, a downward one for a sell, a diamond where the company
          did something (dividend, split, earnings), a hollow ring where there was news, and a
          small dot for a plain close. The key sits under the chart. A point can be several of
          these at once, so it takes the most personal one — your own trade before the
          company&apos;s action before the commentary — and the table row carries the rest.
        </p>
        <p>
          <strong className="text-ink">Dividends, splits and reported quarters</strong> are also
          spelled out in the table&apos;s <strong className="text-ink">Note</strong> column
          alongside whatever you typed against the trade itself. An earnings chip shows reported EPS against the estimate, green for a
          beat and red for a miss. An event dated to a day the market was shut is shown against
          the last close on or before it, so every row&apos;s price is a real one; anything
          falling outside the fetched price history is counted under the table rather than
          plotted at a guessed price.
        </p>
        <p>
          The <strong className="text-ink">News</strong> button on a row opens that day&apos;s
          stories for the ticker. Expect it to be empty on older rows: the news provider only
          indexes recent coverage, so a trade from a year ago has nothing attached — which is not
          the same as a quiet day, and the panel says so rather than leaving you guessing. Events
          have no such limit and go back as far as the price history does.
        </p>
        <p>
          <strong className="text-ink">Market</strong> is what the price provider returns right
          now: <strong className="text-ink">Quote</strong>,{" "}
          <strong className="text-ink">Price history</strong> over 1M to 5Y,{" "}
          <strong className="text-ink">Risk</strong> (annualized volatility, the 52-week range and
          where today sits in it, correlation to SPY) and{" "}
          <strong className="text-ink">News</strong>. Nothing under Market is stored — a tab fetches
          when you open it, so the dialog costs one database read until you ask for more.
        </p>
        <p>
          A symbol you only watch and never held opens too: the holding figures read as empty
          rather than zero, which is the honest answer.
        </p>
      </Section>
      <Section title="Refreshing, and the daily history">
        <p>
          The <strong className="text-ink">refresh icon</strong> beside the Dashboard heading fetches
          a live price for every position, naming each ticker in the progress bar as it goes, then
          files today&apos;s totals — Stock, ETF, Other and Total — in the value history. There is{" "}
          <strong className="text-ink">one row per day</strong>: press it again this afternoon and
          today&apos;s row is recalculated and overwritten, not duplicated.
        </p>
        <p>
          A ticker that can&apos;t be priced is skipped and counted at the end of the run; the rest
          still refresh and the snapshot still saves, so one delisted symbol can&apos;t cost you the
          day&apos;s record.
        </p>
      </Section>
      <Section title="Rearranging this screen">
        <p>
          Which cards appear here, and in what order, is set under{" "}
          <strong className="text-ink">Configuration &rarr; Dashboard widgets</strong>. The{" "}
          <strong className="text-ink">Statistics</strong> card holds the week/month/year rollups and
          the counters; it starts collapsed, since those are numbers you look up rather than watch.
        </p>
      </Section>
      <Section title="Daily Glance, and the News button">
        <p>
          <strong className="text-ink">Daily Glance lives on the home screen</strong> rather than on
          this dashboard, as the last of the three cards below the module carousel. It appears there
          once you hold at least one position, and you can fold it shut by clicking its title.
        </p>
        <p>
          Its table is today by instrument type — what each bucket is worth, what it moved in
          dollars, and what that is as a percentage — with the portfolio total on the last row. <strong className="text-ink">Other</strong> (bonds, funds, crypto, cash) only appears
          when you hold something in it. Below that are the five biggest risers and fallers.
          Stocks and ETFs are ranked <strong className="text-ink">together</strong> — the question is
          which holdings moved, not which kind they are — and a ticker held in two accounts is
          counted once, summed.
        </p>
        <p>
          The <strong className="text-ink">Measure by</strong> selector switches the two lists
          between <strong className="text-ink">Total value</strong> — shares × the price move, i.e.
          what the holding made or lost <em>you</em> — and{" "}
          <strong className="text-ink">Per share</strong>, the move on a single share regardless of
          how much you hold. A thousand shares up a penny beats two shares up $200 on total value,
          and loses badly on per share. Whichever is showing, the other is repeated in grey beneath
          it, and the percentage is the same under both — a percentage doesn&apos;t care how many
          shares you own.
        </p>
        <p>
          The selector governs the mover lists only. The table above is always totals, because a
          per-share figure across a basket of securities at different prices wouldn&apos;t mean
          anything.
        </p>
        <p>
          <strong className="text-ink">News</strong> on any row fetches the story most likely to
          explain that move. Providers tag stories loosely — a piece headlined &ldquo;AMD
          tumbles&rdquo; is often tagged NVDA too — so a story that only mentions the ticker rather
          than being about it is labelled as such, and one published before today says so instead of
          pretending to explain this morning.
        </p>
      </Section>
      <Section title="Week / month / year to date">
        <p>
          These <strong className="text-ink">sum each day&apos;s move</strong> rather than comparing
          the first and last day&apos;s value. That matters: if you paid $10,000 in on Wednesday,
          comparing values would call it a $10,000 gain. Summing daily moves counts only price
          changes, so these are performance, not cash flow.
        </p>
        <p>
          Each tile shows how many days it actually had — a day you never pressed Refresh All is a
          day whose move is missing from the total, so the count is there to make that visible
          instead of silently under-reporting.
        </p>
      </Section>
      <Section title="Why some numbers read “—”">
        <p>
          A dash means <em>not known</em>, not zero. Cost basis, total return and annual income only
          appear once something has supplied them — a broker CSV, or the fields on the position form.
          A position added by hand with just a ticker and a quantity has a value but no return, and
          the dashboard says so rather than printing a fake 0%.
        </p>
        <p>
          The value history starts the first day you press Refresh All. Earlier days can&apos;t be
          back-filled — the app stores each position&apos;s current price, not a per-day price series
          for whatever you held back then.
        </p>
      </Section>
    </>
  );
}

function PositionsInstructions() {
  return (
    <>
      <Section title="Stocks, ETF and Others">
        <p>
          The grid is split into three tabs by instrument type, with a count on each.{" "}
          <strong className="text-ink">Others</strong> is everything that isn&apos;t a stock or an
          ETF — bonds, mutual funds, crypto, cash. That is the same three-way split the
          dashboard&apos;s Daily Glance table and the daily value history use, so the tabs and those
          totals can never disagree about what counts as what.
        </p>
        <p>
          Each tab totals its own column footers, so switching tabs re-totals for what&apos;s in
          front of you rather than the whole portfolio. There is no{" "}
          <strong className="text-ink">Type</strong> column on Stocks or ETF — the tab already says
          it — but Others keeps one, because that tab holds bonds, funds, crypto and cash together
          and the type is the only thing separating them. Stocks and ETF share a column layout;
          Others has its own. A position&apos;s type is set on the row itself, so correcting one
          moves it between tabs.
        </p>
      </Section>
      <Section title="A position belongs to an account">
        <p>
          A holding is identified by <strong className="text-ink">account + ticker</strong>, so 75
          shares of MSFT at one broker and 69 at another are two rows that add up, not one that
          overwrites the other. Positions that predate any account — or that you import without
          choosing one — sit in <strong className="text-ink">Unassigned</strong>. That&apos;s a real,
          supported state; set up accounts under Account Performance when you want them separated.
        </p>
        <p>
          Because account + ticker is the identity, both are locked when editing. To move a holding to
          another account, delete it and add it there.
        </p>
      </Section>
      <Section title="Cost basis, and the fields under the fold">
        <p>
          The collapsed &ldquo;Cost basis, income and identifiers&rdquo; panel holds what a broker
          export fills in: total cost, unit cost, unrealized gain, CUSIP/ISIN, asset class and asset
          strategy. Adding a position by hand you can ignore all of it — but entering a cost basis is
          what turns on the Total Return figures here and on the dashboard.
        </p>
        <p>
          <strong className="text-ink">Asset strategy</strong> (e.g. &ldquo;US Large Cap&rdquo;) is a
          separate axis from <strong className="text-ink">Type</strong> (Stock/ETF/Bond). Type drives
          the allocation split; strategy is the broker&apos;s own cap-size bucket.
        </p>
      </Section>
      <Section title="Refresh All">
        <p>
          Pulls a live quote for every position and updates price, day range, day gain/loss and
          dividend rate. Your cost basis and the broker&apos;s classification are left alone — a quote
          feed knows today&apos;s price, not what you paid — but the unrealized gain is recomputed
          against the stored basis so it can&apos;t sit stale beside a fresh price. A ticker that
          can&apos;t be quoted (delisted, renamed) is reported and skipped; the rest still refresh.
        </p>
      </Section>

      <Section title="Auto refresh on schedule">
        <p>
          Under <strong>Configuration &rarr; Auto refresh on schedule</strong> you can let the
          server do all of that on its own — every hour, every half day, or every day. It runs the
          same three steps as Refresh All (prices, then sectors, then the day&apos;s snapshot), so
          the value history stops having gaps on days nobody pressed the button.
        </p>
        <p>
          The switch is off until you turn it on, and a change takes effect within a minute
          without restarting anything. <strong>Run refresh now</strong> in that card ignores both
          the switch and the interval, so you can try a pass before committing to a schedule.
          Every day is the sensible default: a portfolio&apos;s numbers move on a daily cadence,
          and the quote feed is a free service that&apos;s better not hammered.
        </p>
      </Section>
    </>
  );
}

function TransactionsInstructions() {
  return (
    <Section title="Transactions are the history, not the holding">
      <p>
        Recording a buy here does <em>not</em> change a position&apos;s quantity — the two are kept
        independent so an imported broker snapshot is never contradicted by a hand-typed trade. What
        transactions do feed is the average cost basis the next-day scan uses when a position
        doesn&apos;t carry one of its own.
      </p>
      <p>
        Total is computed from shares &times; price/share, so it can&apos;t disagree with its parts.
      </p>
    </Section>
  );
}

function AccountsInstructions() {
  return (
    <>
      <Section title="Accounts and their history">
        <p>
          An account is a brokerage account. Its performance records are point-in-time total values —
          one per date — which is what the history chart plots. Adding an account here also makes it
          selectable when you import a positions CSV, which is how positions stop being
          &ldquo;Unassigned&rdquo;.
        </p>
      </Section>
      <Section title="Account Performance Over Time">
        <p>
          Every account&apos;s recorded value on one set of axes. Click an account&apos;s chip to
          drop its line from the chart — the table below and the{" "}
          <strong className="text-ink">Total recorded</strong> column follow the same selection, so
          what you read always matches what you see.
        </p>
        <p>
          Accounts are usually recorded on their own schedules — a 401k quarterly, a brokerage
          monthly. The axis is every date <em>any</em> account reported, and a line is drawn
          straight between the dates that account actually reported. The dots are the real records;
          the segment between them is joining them up, not data. A blank cell in the table means
          nothing was recorded that day, which is <strong className="text-ink">not</strong> the same
          as a zero balance, and the total only sums the accounts that reported on that date.
        </p>
        <p>
          <strong className="text-ink">Smooth the line</strong> is off by default on purpose. A
          curve through periodic balances looks like it knows what happened in between, and it
          doesn&apos;t — straight segments look like the interpolation they are. Turn it on when
          you want the shape of the trend rather than the individual readings.
        </p>
      </Section>
      <Section title="Instrument">
        <p>
          The chips above the chart are the instrument panel — the card has no separate legend,
          because two controls where one does nothing is worse than one that works. Each chip is an
          account: filled means plotted, outlined means dropped. The dot carries that
          account&apos;s line colour, and the figure beside the name is its change across every
          record it has.
        </p>
        <p>
          It opens with the <strong className="text-ink">first account only</strong>. Overlaying
          everything at once is unreadable past a few accounts, and the largest balance flattens the
          rest against the axis — so start with one line and click in the accounts you actually want
          to compare. Your selection then stays put; it isn&apos;t reset when the data reloads.
        </p>
        <p>
          Selection drives the whole card, not just the chart. The table columns, the{" "}
          <strong className="text-ink">Total recorded</strong> figure, and the CSV export all follow
          the same chips, so a number you read is always a number you can see. Drop every account and
          the chart steps aside and tells you so rather than drawing an empty grid.
        </p>
        <p>
          To read one account&apos;s balance history in detail, leave it as the only chip selected —
          the end-of-line label is its latest value, and the table beneath lists newest first. To
          compare, add a second chip and watch the gap rather than the absolute levels; accounts
          reporting on different schedules will step at different dates.
        </p>
      </Section>
    </>
  );
}

function WatchTestInstructions() {
  return (
    <>
      <Section title="Watch lists">
        <p>
          Tickers you&apos;re following but don&apos;t own. Nothing here affects the portfolio totals.
        </p>
      </Section>
      <Section title="The next-day scan">
        <p>
          Runs over every position with shares and flags four things: <strong className="text-ink">Stop
          Loss</strong> (price below the 20-day SMA), <strong className="text-ink">Trim Profit</strong>{" "}
          (return above your profit target), <strong className="text-ink">Rebalance</strong>{" "}
          (allocation over its concentration cap) and{" "}
          <strong className="text-ink">Strong Buy</strong> (a 1.5&times; volume spike). Anything else
          is a Hold.
        </p>
        <p>
          It fetches a month of price history per ticker, so a scan over a large portfolio takes a
          moment. The thresholds live under Configuration.
        </p>
      </Section>
      <Section title="The simulation">
        <p>
          A back-test, not a forecast. Type a ticker and a number of shares, tick the windows you
          want, and each one answers the same question: <em>had you bought those shares at the
          start of this window and held them to today, where would you be?</em>
        </p>
      </Section>
      <Section title="What a time range means here">
        <p>
          A range is a <strong className="text-ink">hypothetical entry date</strong>, not a holding
          period going forward. &ldquo;6 M&rdquo; buys at the close six months ago; &ldquo;5 Y&rdquo;
          buys at the close five years ago. Every row therefore shares one current price and
          differs only in what it assumes you paid, which is why picking several ranges at once is
          the point of the screen — the table lets you read a column straight down and compare
          them.
        </p>
        <p>
          The buy price is a real close from the price feed, not an average or an adjusted basis.
        </p>
      </Section>
      <Section title="What the numbers leave out">
        <p>
          <strong className="text-ink">Price return only.</strong> Dividends, commissions,
          spreads and taxes aren&apos;t counted, so a high-yield holding will look worse here than
          it did in reality. Nothing is saved either — a run is a question, not a position, and
          leaving the screen discards it.
        </p>
      </Section>
      <Section title="Ranges that come back empty">
        <p>
          A window longer than the symbol has existed for has no starting close, so it&apos;s
          listed under the table as unavailable rather than given a row with a wrong number in it.
          A fresh listing can fail every range but the shortest, and that&apos;s the honest answer.
        </p>
      </Section>
      <Section title="Reading the Price Overlay">
        <p>
          Each line is one range, drawn as <strong className="text-ink">percent change from its
          own buy price</strong> against how far through that range it is — so every line starts
          at 0% on the left and ends at its total return on the right. That normalising is what
          lets a one-week line and a ten-year line share an axis; plotted as real dates and real
          dollars, the decade would squash the week into a few pixels.
        </p>
        <p>
          The x-axis is progress, not time. Two points at &ldquo;50%&rdquo; are half way through
          their own windows, not the same date.
        </p>
      </Section>
    </>
  );
}

function ChartsInstructions() {
  return (
    <Section title="What's computed here">
      <p>
        Volatility, correlation and Sharpe ratio, from downloaded price history rather than from your
        cost basis — so these describe the securities you hold, not your particular entry prices.
        Results are cached; re-run them when you want them refreshed.
      </p>
    </Section>
  );
}

function ImportInstructions() {
  return (
    <>
      <Section title="Map once, reuse forever">
        <p>
          Pick the kind of file, drop the CSV in, and the columns are guessed from their headers.
          Correct anything wrong, then save the mapping under the broker&apos;s name — next quarter&apos;s
          export is one dropdown away. A mapping belongs to one import type, so switching the type
          re-reads the file rather than carrying a mapping that can&apos;t apply.
        </p>
        <p>
          Columns left on <strong className="text-ink">Ignore</strong> are skipped. Every column you
          don&apos;t need can stay ignored — a broker export with 70 columns is normal.
        </p>
        <p>
          A saved mapping also remembers{" "}
          <strong className="text-ink">which account each label in the file means</strong>. On an{" "}
          <strong className="text-ink">Account Performance</strong> import, whatever the file calls
          an account — <span className="font-mono text-xs">Fidelity HSA</span> — is matched once to
          the account you actually keep here (Fidelity Health Savings Account), and saved with the
          mapping. Re-import next quarter and it goes straight through; you&apos;re only asked again
          when the file contains a label the mapping hasn&apos;t seen.
        </p>
        <p>
          The match survives editing the account afterwards. It stores both the account and the
          name it had, so renaming the account keeps working, and so does deleting and recreating
          it. If neither still exists the label is treated as unrecognised and you&apos;re asked —
          rather than the row being silently attached to the wrong account.
        </p>
      </Section>
      <Section title="Dropping rows you don't want">
        <p>
          The grid lists <strong className="text-ink">every</strong> row in the file, numbered.
          Press <strong className="text-ink">&times;</strong> on any row to leave it out — it stays
          visible, dimmed and struck through, so the numbering still lines up with your file, and{" "}
          <strong className="text-ink">Undo</strong> puts it back. The Import button counts what will
          actually go in.
        </p>
        <p>
          A removed row isn&apos;t reported as a skip afterwards. Skips are rows the importer
          choked on and you may want to look at; a row you deliberately dropped isn&apos;t news.
          Removals apply to this file only and reset when you load another.
        </p>
      </Section>
      <Section title="Setting Type per row">
        <p>
          A positions import gets a <strong className="text-ink">Type</strong> column of its own,
          before the file&apos;s columns — a dropdown per row. It starts on whatever the file implies
          (an &ldquo;Equity&rdquo; asset class reads as Stock, a money-market line as Other), and you
          change the rows that are wrong. That&apos;s the answer for an export that mixes ETFs and
          stocks without saying which is which.
        </p>
        <p>
          <strong className="text-ink">Set all…</strong> in that column&apos;s header stamps every
          row at once, so a mostly-ETF file is one click plus a few corrections rather than 34
          dropdowns.
        </p>
        <p>
          A per-row choice beats the column-wide fixed value below, because it&apos;s the more
          specific thing you said. Like row removals, these are per-file and reset when you load
          another.
        </p>
      </Section>
      <Section title="Fixed values, for what the file doesn't say">
        <p>
          Under each mapped column there&apos;s a <strong className="text-ink">= fixed value</strong>{" "}
          box. Type something in it and every row gets that literal, ignoring the column&apos;s own
          cells. It&apos;s how you set a field the export has no column for: pick any spare column,
          map it to <strong className="text-ink">Type</strong>, and type{" "}
          <strong className="text-ink">ETF</strong> — the whole file imports as ETFs.
        </p>
        <p>
          A fixed value <em>beats</em> the cell, so it also works as an override: a column reading
          &ldquo;Equity&rdquo; would normally infer Stock, and fixing it to ETF wins. Anything fixed
          is listed in a banner under the table before you import, so it can&apos;t be a surprise.
          Clear the box and the cells are read again.
        </p>
        <p>
          Fixed values are <strong className="text-ink">saved with the mapping</strong> — a mapping
          named &ldquo;Chase ETFs&rdquo; carries its Type = ETF along with its columns, so next
          quarter&apos;s file is one dropdown away.
        </p>
      </Section>
      <Section title="What each type does on re-import">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Positions</strong> — updates the matching account + ticker in
            place, so re-importing refreshes rather than duplicates. Choose the account first: without
            one, everything lands in Unassigned. A blank or zero cell keeps whatever was stored, so a
            partial export can&apos;t wipe a field it doesn&apos;t include.
          </li>
          <li>
            <strong className="text-ink">Transactions</strong> — see &ldquo;Importing the same
            trades twice&rdquo; below for how duplicates are judged. If your dates are ambiguous, set
            the date format on that column and they&apos;re read strictly by it instead of guessed.
            Map either <strong className="text-ink">Price / share</strong> or{" "}
            <strong className="text-ink">Total amount</strong>: given only a total, the per-share
            price is worked back out of it. An explicit price wins if you map both.
          </li>
          <li>
            <strong className="text-ink">Account Performance</strong> — one value per account per
            date; a repeat of the same pair replaces it. Map an Account Name column and you&apos;ll be
            asked to match the names in the file to your accounts before anything is written.
          </li>
        </ul>
      </Section>
      <Section title="Importing the same trades twice">
        <p>
          If your export has a{" "}
          <strong className="text-ink">Broker reference / confirmation #</strong>, map it. That
          identifies a trade exactly: a row whose reference is already stored is skipped, and nothing
          else can be confused for it.
        </p>
        <p>
          Without one, duplicates are judged by <em>how many</em>. A transaction&apos;s date has no
          time on it, so buying the same ticker in three lots through one day gives three rows that
          look identical — and all three are real. So the importer counts the copies in your file
          against the copies already stored and adds only the shortfall: three in the file against
          none stored imports three, and re-importing that file imports nothing. If a later export
          shows five lots where you&apos;d imported three, it adds the two new ones.
        </p>
        <p>
          <strong className="text-ink">Brokerage firm</strong> is part of that comparison, so the
          same trade at two firms is two transactions rather than one being mistaken for the other.
        </p>
      </Section>
      <Section title="Derived fields">
        <p>
          If an export gives a total cost but no per-share cost, unit cost is worked out from cost
          &divide; quantity. If it gives a cost but no unrealized gain, that&apos;s worked out from
          value &minus; cost. Mapping the broker&apos;s own column always wins over the derivation —
          its figure accounts for adjusted basis that value &minus; cost cannot.
        </p>
        <p>
          When there&apos;s no Type column, the type is inferred from the asset class: Equity becomes
          Stock, a money-market or cash line becomes Other. An unrecognised class leaves the existing
          type alone.
        </p>
      </Section>
    </>
  );
}

function SettingsInstructions() {
  return (
    <>
      <Section title="Dashboard widgets">
        <p>
          Ticks decide what the Dashboard section draws; the arrows decide the order. Nothing is
          saved until you press <strong className="text-ink">Save layout</strong>, so you can shuffle
          several rows and write them once.
        </p>
        <p>
          Hiding a widget only changes what&apos;s drawn — nothing stops being recorded, and no
          layout can cost you the daily snapshot: the refresh icon lives on the Dashboard heading
          rather than in a widget, so it can&apos;t be hidden.
        </p>
        <p>
          A widget added to the app in a later release appears at the bottom, visible, rather than
          being silently missing from a layout saved before it existed.
        </p>
      </Section>
      <Section title="Where these are stored">
        <p>
          Both the layout and the three thresholds are module settings — the thresholds are the same
          values Administration &rarr; Module Configuration edits, so changing them here changes them
          there. Thresholds take effect on the next scan; results already on screen aren&apos;t
          re-judged.
        </p>
      </Section>
    </>
  );
}

export function StockInstructions({ section }: { section: StockSection }) {
  switch (section) {
    case "main":
      return <MainInstructions />;
    case "positions":
      return <PositionsInstructions />;
    case "transactions":
      return <TransactionsInstructions />;
    case "accounts":
      return <AccountsInstructions />;
    case "watch-test":
      return <WatchTestInstructions />;
    case "charts":
      return <ChartsInstructions />;
    case "import":
      return <ImportInstructions />;
    case "settings":
      return <SettingsInstructions />;
    default:
      return null;
  }
}
