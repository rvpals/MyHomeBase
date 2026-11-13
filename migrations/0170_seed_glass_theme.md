# Migration 0170: seed the Glass theme

**Type:** data seed (no schema change)

Adds a ninth built-in row, `glass`, to `sys_color_themes` (sort order 90).

## Why the tokens are opaque

The table's CHECKs and `hexColorSchema` accept only `#RRGGBB`, so the row cannot hold the
translucent `rgba()` values the design calls for. The row holds opaque **fallbacks**; the
real translucent surfaces, `backdrop-filter`, luminous shadows and ambient orbs are in
`src/app/globals.css` under `[data-color-theme="glass"]`. `layout.tsx` sets that attribute
on `<html>` from the active theme id, so **the id `glass` is load-bearing — don't rename it.**

Flat chrome and thin borders are applied by the same CSS block, not by the global
`chrome_style` / `border_widths` settings (those aren't theme properties).

`INSERT OR IGNORE`, so re-running never clobbers an admin's edits.

## Rollback

```sql
DELETE FROM sys_color_themes WHERE id = 'glass';
```

Do it only while another theme is active; resolution otherwise falls back to the default.
