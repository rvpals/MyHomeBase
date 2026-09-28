# The app's webfonts, committed

These `.woff2` files are loaded by `next/font/local` in `src/app/layout.tsx`.
They are **committed on purpose** — do not replace them with a build step.

## Why they live here

The app used to load all eight families through `next/font/google`, which
downloads them from `fonts.gstatic.com` *while the build runs*. `npm run build`
clears `.next` first, so nothing was cached between builds and every release was
gated on eight consecutive successful fetches through a corporate network. A
single hiccup aborted `npm run publish:nas` with:

```
Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
```

which reads like a code bug in `layout.tsx` and is not one — it is Turbopack
failing to turn a bad fetch into a font descriptor. It recurred across several
release attempts and blocked each one.

With the files here and `next/font/local` loading them, **a build never touches
the network**. Builds are offline, deterministic, and faster.

## Refreshing them

```
node scripts/fetch-fonts.mjs
```

Then commit the result. The script is not part of `npm run build` and must never
be wired into it — that would restore the exact failure this replaced.

## What's here, and why the filenames differ

Most of these families are **variable fonts** on Google Fonts: one file covers a
whole weight range, so `wght@500;600;700` returns three `@font-face` blocks all
pointing at the same URL. Those are stored once as `<slug>-variable.woff2`.
IBM Plex Mono is genuinely three separate static files, so it keeps per-weight
names. The script detects which case applies by comparing URLs rather than
assuming.

| File | Family | Covers |
| --- | --- | --- |
| `space-grotesk-variable.woff2` | Space Grotesk | 500, 600, 700 |
| `sora-variable.woff2` | Sora | 500, 600, 700 |
| `familjen-grotesk-variable.woff2` | Familjen Grotesk | 500, 600, 700 |
| `manrope-variable.woff2` | Manrope | 200–800 |
| `inter-variable.woff2` | Inter | 100–900 |
| `ibm-plex-mono-400.woff2` | IBM Plex Mono | 400 |
| `ibm-plex-mono-500.woff2` | IBM Plex Mono | 500 |
| `ibm-plex-mono-600.woff2` | IBM Plex Mono | 600 |
| `jetbrains-mono-variable.woff2` | JetBrains Mono | 400, 500 |
| `great-vibes-variable.woff2` | Great Vibes | 400 |

All are the **`latin` subset only**, matching what every loader asked for
(`subsets: ["latin"]`).

### One trap worth knowing about

Google's CSS API **ignores `&subset=latin`**. The stylesheet comes back with a
block per subset — vietnamese, latin-ext, latin — each with its own URL and
`unicode-range`. Taking the first `.woff2` per weight gets you *vietnamese*: a
~1.6 KB file that renders almost no English text, and which looks like a valid
font by every cheap check (`wOF2` magic bytes, non-zero length). The fetch
script picks the latin block by its `unicode-range` containing `U+0000-00FF`.
If you ever hand-download a replacement, check the same thing.

## Licences

All ten files are open-licence and redistributable under the **SIL Open Font
License 1.1**, which permits bundling them in an application:

- Space Grotesk — OFL 1.1, © Florian Karsten
- Sora — OFL 1.1, © Jonathan Barnbrook / Indian Type Foundry
- Familjen Grotesk — OFL 1.1, © Elias Hanzer
- Manrope — OFL 1.1, © Mikhail Sharanda
- Inter — OFL 1.1, © The Inter Project Authors
- IBM Plex Mono — OFL 1.1, © IBM Corp.
- JetBrains Mono — OFL 1.1, © JetBrains s.r.o.
- Great Vibes — OFL 1.1, © Robert Leuschke / TypeSETit

The OFL requires the licence and copyright notice be retained with the fonts;
this file is that notice. Full text: <https://openfontlicense.org/>
