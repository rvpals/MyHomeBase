# Migration 0149: the Popup option on a ticker monitor

**Date:** 2026-10-16
**Type:** new column (1) on each of two existing tables

## What this does

Adds an opt-in to `inv_ticker_monitors` that makes a firing monitor interrupt the home
screen, and copies that flag onto the message it files.

| Table | Column | Type | Notes |
|---|---|---|---|
| `inv_ticker_monitors` | `is_popup` | `INTEGER NOT NULL DEFAULT 0` | 1 = also show a popup when this monitor fires |
| `sys_messages` | `is_popup` | `INTEGER NOT NULL DEFAULT 0` | 1 = this message is still waiting to be popped up |

No new table. **Existing rows take the default and keep behaving exactly as they do
today** — they file a message and mark the ticker, and nothing pops up.

## The problem it solves

Every monitor from 0110 and 0148 reports the same single way: a row in `sys_messages`
and a marker on the ticker. That is the right default. A monitor is a standing question
and the answer usually keeps.

Some answers do not keep. *"BMY is back at $45"* is useful while it is still true, and a
message sitting unread behind a badge is indistinguishable from no message at all —
particularly on a household screen that may not be opened for a day.

So the reader gets to say, per monitor, *this one is worth being interrupted for.*

## Delivery, not kind

The flag changes **how a monitor reports**, not **what it watches**. That is why it is a
column and not a sixth `monitor_type`: all five existing types can be popups, and
folding the choice into the type would have doubled the enum and every switch over it.

It is also why the reversal has nothing to delete. 0148's reversal had to remove rows
first, because dropping `direction` would have left `day_move_pct` rows that no longer
knew which way they watched — the column was part of the *condition*. Nothing here is:
drop `is_popup` and every monitor still means exactly what it meant.

## Why the flag is copied onto the message

The second column is the one worth recording, because "surely you can just join back to
the monitor" is the obvious objection. There is deliberately no `monitor_id` here to
join on.

**A message outlives the monitor that wrote it.** 0109 gives this reasoning for
`source` and 0142 repeats it for `module`; it applies unchanged. A monitor deleted an
hour after firing must not strand a pending popup that can no longer explain itself.

**A monitor's settings move.** Untick Popup this afternoon and the message filed this
morning *was* a popup when it was filed. The column records what was true at the moment
of firing, which is the only reading under which a pending popup is ever correct.

The two values drift on purpose. `sys_messages.is_popup` is a fact about the message;
`inv_ticker_monitors.is_popup` is a setting that applies to the next firing.

## What stops a popup reappearing: `read_at`

The dismissal latch is the column the queue already has.

```sql
SELECT * FROM sys_messages WHERE read_at IS NULL AND is_popup = 1
```

Clicking **OK** marks those messages read. That both dismisses the popup and clears them
from the bell badge, because the popup and the queue entry are **one record, not two**.

A separate `inv_monitor_popup_dismissals` table was considered and rejected. It would
have let the two states disagree, and would have had to answer *"read, but not
dismissed"* — a state nothing in the app wants and every read would have to handle.

Consequences, both intended:

- **Household-wide**, like the monitors (0110) and the queue itself (0109). Whoever
  clicks OK clears it for everybody. A monitor is a fact about a shared position, so the
  notice about it is shared too.
- **A re-fire makes a new popup.** The fire-once latch (`is_triggered`, 0110) is
  untouched: leaving the band re-arms the monitor, and the next crossing files a fresh
  message that is unread and therefore pending again. Dismissing is not "turn this
  monitor off".

## No new index

`idx_messages_unread` (0109) is a **partial** index on exactly `read_at IS NULL`, which
is the expensive half of the pending-popup predicate. What remains is a flag test over
the unread rows alone.

An index on `is_popup` would cost every INSERT — and the Hello, world! job inserts a row
a minute — to speed up a scan that is already reading the small half of the table.

Both `ALTER`s are `ADD COLUMN` with a constant default, so SQLite rewrites no rows and
neither table is rebuilt. 0109's two indexes and 0110's `idx_ticker_monitors_ticker`
survive untouched.

## Reversal

```sql
ALTER TABLE inv_ticker_monitors DROP COLUMN is_popup;
ALTER TABLE sys_messages        DROP COLUMN is_popup;
```

Safe in either order, and nothing to delete first. Every message stays in the half it is
in; every monitor keeps filing. The only thing lost is the opt-in.
