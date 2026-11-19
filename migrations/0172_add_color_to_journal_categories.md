# Migration 0172: a colour for each journal category

**Date:** 2026-11-19
**Type:** new column

## What this does

Adds one column to `jrn_categories`, the managed category list from migration 0027.

| Column | Type | Notes |
|---|---|---|
| `color` | `TEXT NOT NULL DEFAULT ''` | a tint key — `rose`, `amber`, `sage`, `ocean`, `indigo`, `slate`; `''` = no colour |

## Why

The Journal Calendar's redesign puts a small dot before every entry title in a day
cell. A dot in one colour carries nothing, so the dot takes the colour of the entry's
first category (in the entry's own category order) that has one. An entry with no
coloured category gets the theme accent.

The colour is chosen in Journal → Categories → Edit, with the same six-swatch picker
Clips uses for its cards.

## Why a key and not a hex value

design.md → *Tinted surfaces*: a reader-chosen colour is stored as a key and mixed
into the theme at render. A stored `#e11d48` would be one fixed value across nine
themes, light and dark; the key lets `globals.css` own what "rose" looks like. The
keys are the shared palette in `src/lib/shared/tint.ts`, the same ones
`clp_clips.card_color` already stores (migration 0155).

**The keys are permanent.** Renaming one blanks every category that used it back to
the default dot.

## Nothing is backfilled

Every existing category starts with no colour, so every dot on the calendar is the
theme accent until a reader picks colours. That is the correct reading — nobody has
chosen a colour yet.

## Rolling back

`color` is named by no index and no trigger, so `ALTER TABLE jrn_categories DROP
COLUMN color` removes it directly. Only the chosen colours are lost; the calendar's
dots fall back to the accent.
