# 0075 — Register the Games module

Adds the `sys_modules` row for the module whose table `0074` created, so it shows on
the home grid and the app bar and becomes grantable per user.

Kept as its own numbered migration rather than folded into `0074`, per the recipe in
`modules.md`: the table and the module's *registration* are separate concerns, and
the seed is the thing that must stay in step with `DEFAULT_MODULES`.

| Field | Value |
|---|---|
| Slug | `games` |
| Short name | `Games` |
| Long name | `Games & Puzzles` |
| Description | `Play a quick game and keep a high-score board.` |
| Sequence | 8 |
| Icon | `game` |
| Table prefix | `gam_` |

**Sequence 8** is the next unused integer. 1 remains vacant — it belonged to the
retired Real Estate module, along with the `rei_` prefix, which must not be reused.

## The icon is a new concept, and it ships complete

`MODULE_ICON_NAMES` gains a 14th entry, `game`. Music Library (0053) borrowed
`heart` and waited until 0055 for a real glyph; this one does not, because the cost
turned out to be lower than that precedent suggests. Every one of the 11 installed
`@iconify-json` packages was checked and each has a genuine gamepad or controller
glyph, so all 12 generated sets name an explicit candidate that resolves on the
first try — nothing falls through to the keyword fallback, which is the mechanism
that produced "school-bus-side" for a classroom.

| Set | Glyph | | Set | Glyph |
|---|---|---|---|---|
| lucide | `gamepad-2` | | hugeicons | `game-controller-01` |
| tabler | `device-gamepad-2` | | streamline-color | `controller` |
| material-symbols | `sports-esports` | | flat-color-icons | `puzzle` |
| mingcute | `game-2-fill` | | fluent-emoji-flat | `video-game` |
| ph | `game-controller-duotone` | | fluent-emoji | `video-game` |
| solar-line-duotone | `gamepad-line-duotone` | | solar-bold-duotone | `gamepad-bold-duotone` |

`flat-color-icons` is the one compromise: it has 329 icons and no controller at all,
so it gets `puzzle`. The alternative was no glyph, and a missing *module* concept is
fatal to `scripts/gen-icon-glyphs.mjs` by design — the toolbar has no other artwork
to fall back on.

The hand-drawn `classic` glyph is a gamepad: a rounded body, a D-pad cross left, two
filled buttons right. The buttons are filled for the same reason `Music`'s noteheads
are (0055) — a hairline circle either vanishes or reads as a stray tick at the 16px
the app bar draws it at.

**No `UPDATE sys_modules` here.** Nothing is being retired from
`MODULE_ICON_NAMES`, and seeding a new module's icon is part of its INSERT
(`modules.md` → *Icons*). Changing which name a module uses later is an admin
action, not a migration.

## What this migration does not add

No table for the games themselves — see `0074`'s log. The catalogue is code, so
registering the module is genuinely just this one row.
