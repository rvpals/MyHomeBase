# Reading a bubble answer sheet — the method

How to decode a scanned multiple-choice answer sheet, written so it can be
reimplemented from scratch in another codebase or another language.

Everything here was arrived at by failing against real scans and measuring why. The
numbered sections are the algorithm; the **Traps** sections are the mistakes that cost
the most time, each with the measurement that exposed it. The traps are the valuable
part — the happy path is obvious, and every one of these bugs looked like a threshold
problem until it was measured.

**Status of the reference implementation:** reads a real 15-question scan 15/15,
including a deliberately blank row and a deliberately double-marked row. Known gaps are
listed in §11.

---

## 0. The one principle

**Measure the page; do not predict it.**

Every serious bug below is the same bug: some position was *computed* from an
assumption instead of *read* off the paper. Scale, rotation, row pitch, the ink
threshold — each failed the moment the assumption drifted from reality, and each was
fixed by finding something printed and measuring it.

Corollary: the printer and the detector must share **one** source of geometry. If the
code that draws the sheet and the code that reads it each compute bubble positions,
they will diverge, and the failure will look like bad detection rather than a layout
bug.

Second corollary, learned the hard way: **sharing a constant is not enough -- it has
to be a constant that means the right thing.** A figure used to *reserve* space is
deliberately padded, because over-reserving costs paper while under-reserving corrupts
the layout. A figure used to *locate* something must be exact. Those are different
numbers wearing the same name, and the QR decoder spent its whole life cropping 38px
below the code because it borrowed the padded one. Printer and detector agreed
perfectly; they were just both wrong.

Third: **a silent fallback hides a dead feature.** That decoder failed on every sheet
and nothing surfaced, because identity quietly fell back to matching the file name,
which usually works. Make the fallback *visible* -- this implementation reports whether
a student was identified by code or by file name, and that caption is the only reason
the failure was ever noticed.

---

## 1. What to print

The sheet is a contract between printer and detector. Five features matter.

| Feature | Purpose | Notes |
|---|---|---|
| **Four corner fiducials** | Page-absolute scale, origin, perspective | Solid black squares in the margin corners — see §9 |
| **Two vertical anchor bars** | Locate the answer grid; give rotation | Flank the grid, left and right |
| **Per-row timing ticks** | Find each row directly | The strongest row reference — see §4a |
| **Horizontal row rules** | Give the true row pitch | Fallback when ticks are absent |
| **Bubbles** | The answers | Pale pills — see *Ink weight* below |
| **Column dividers** | Human clarity; column landmarks | Thin rules between choices **and one closing the question-number cell** -- without that first rule the number and choice A share a segment 2.4x the width of every other choice, and a mark beside the number sits in no cell at all |
| **Alternating row bands** | Stops a reader marking the wrong line | Blocks of five; detector-neutral |
| **Student-ID QR** | Machine-readable identity | Optional; only on a sheet printed for a named student -- see §9a |

**One sheet holds at most ~30 questions.** Not a paper limit — five columns at the
tightest pitch fit well over a hundred — but a DETECTOR limit. Past roughly forty the
timing-tick search starts picking up the anchor bars' ends as well as the ticks and the
filter meant to separate them chooses wrong. Measured: 30 questions across two columns
read 30/30; 45 read 35/45 *while still reporting it had found its ticks*, which is the
worst failure mode there is. Longer exams are split across sheets, each one complete in
itself — own fiducials, bars, ticks, full rows, numbered from where the last left off.

### Geometry that worked

Expressed as fractions of the page (0..1), never pixels or millimetres — the renderer
multiplies by its box, the detector by the scanned page, and neither needs the other's
units.

```
corner square         0.045 x 0.028 of the page, inset 0.05 / 0.022 from the edges
anchor bar width      0.012 of page width      (~2mm — see Trap 2)
anchor bar overhang   0.02 beyond the grid     (see Trap 1)
bubble width          0.032 of page width
bubble height         0.0148 of page height    (= 1.67:1 pill on a 1:1.294 page)
timing tick           0.012 wide x 0.009 tall, in the question-number cell
row pitch             0.022 min .. 0.034 max
columns               up to 2
questions per sheet   30 maximum
```

### Ink weight: what is dark matters as much as where

Print the **bubbles pale** and everything the detector must FIND **black**.

A bubble's own outline and letter sit inside the sampling window, so they raise the
floor a real mark has to clear. Measured on a black-outlined circle, the printed ring
and letter contributed about **0.16 of the 0.20** an *empty* bubble read — most of the
baseline was the bubble's own ink. At `#CCCCCC` the outline sits at darkness **0.20**,
below the 0.5 threshold that counts as ink: invisible to the detector, perfectly clear
to a reader, and the empty baseline drops toward paper-white.

The same grey must never be used for the row rules, the timing ticks, the anchor bars
or the fiducials. Those are the features the detector locates, and a pale one is a
missing one.

**Shape: a horizontal pill, about 10pt x 6pt (1.67:1).** Filled by one short stroke
across the middle, where a circle invites a scribble that leaves the edges pale — and a
partial fill is what gets flagged for a human.

**The sheet must be one page.** It is graded by photographing it; a second page means a
second capture and a way for half an exam to go missing. Rather than paginating, choose
however many columns fit the questions in the available height.

### Print-medium traps

**Draw rules with a `border`, never a `background`.** If the print stylesheet forces
`background: #fff` (common, to avoid wasting ink), every background-drawn line is
visible on screen and **invisible on paper**. The grid printed blank and nobody noticed
until a scan came back unreadable.

**`border-width` does not accept percentages.** A bar sized `borderLeftWidth: "1.2%"`
is silently dropped to zero. Use absolute units (`pt`) for anything that must be a known
physical size, and give the element a width as well as a border.

---

## 2. Decode the image

```
1. Apply EXIF orientation            (a phone photo is routinely rotated)
2. Downscale so the longest edge is ~1700px
3. Convert to RGBA, 4 bytes per pixel
```

Downscaling is not just for speed. Averaging neighbouring pixels suppresses paper grain
and JPEG ringing that full resolution would read as ink. 1700px keeps a bubble about
44px across, far more than the sampler needs.

Darkness of a pixel is `1 - luminance`, with `luminance = (0.299R + 0.587G + 0.114B)/255`.

> **Colour note.** Rec. 601 under-weights cyan: a cyan pen separates from paper by 0.48
> where black separates by 0.85. Channel-minimum (`1 - min(R,G,B)/255`) roughly doubles
> cyan's separation. Measured, every common ink *except yellow* clears a sensible
> threshold under plain luminance, so this is optional. Yellow fails both ways — tell
> students not to use it.

---

## 3. Find the anchor bars

For each of the left and right thirds of the image:

```
for each scan row y:
    find the longest horizontal run of dark pixels in the band
    if 3 <= run length <= maxBarWidth:        # maxBarWidth ~ 3.5% of page width
        record (y, centre_x of that run)
keep the longest stretch of consecutive rows, tolerating gaps up to ~1% of height
fit a least-squares line x = f(y) through those centres
the bar's position at any y comes from that line
```

The **tilt** is then `atan2(rightTop - leftTop, rightX - leftX)`, where each bar's
top is measured on its own column. This recovers the angle to within ~0.2°.

### Trap 1 — do not scan for an unbroken dark *column*

The obvious implementation looks for the column with the longest unbroken dark run. It
works on a square page and collapses the moment the page tilts.

A bar is only ~2mm wide, so as the page rotates it **steps sideways** between pixel
columns, and no single column contains it end to end. Measured on a 770px bar:

| Tilt | Longest column run |
|---|---|
| 0° | 770px |
| 1° | 770px |
| 1.5° | 573px |
| 2° | 430px |

The cliff is at `atan(barWidth / barHeight)` — for a 15px bar 770px tall, **1.11°**.
A flatbed scanner puts 1–2° in by itself, so this fails on almost every real scan.
Reads went from 0/15 wrong at 1° to 11/15 wrong at 2°.

Tracking each row's centre, as above, is immune: the bar is followed wherever it drifts.

### Trap 1b — the anchor search band cannot be derived from the layout

A tempting optimisation: narrow the search band using the bar's known page fraction, so
timing ticks and choice dividers fall outside it. This is circular and fails. A scan
carries margins, so a page fraction does not map to a pixel **until the anchors have
been found** — and the anchors are what the search is for. The narrowed band looked for
a bar at x<=112 when the scan had it at x=140, found nothing, and the sheet fell through
to reading the whole image. It still graded correctly, which is worse than failing,
because it hid the fault.

Use a generous band (a quarter of the image from each edge) and exclude other features
by **width** instead — `traceBar` already rejects spans outside bar width, and a tick is
thinner than a bar.

### Trap 2 — reject spans too *wide* to be a bar

A width ceiling is as necessary as a floor. The answer table's own rules run
horizontally, so where one crosses the search band it presents a span far wider than a
bar. Measured: the bar was 13–14px, the question-number cell's rule was 52px. Taking
"the longest span" followed the rule and put the anchor at x=426 instead of x=152 —
every bubble then sampled off the printed area, and the whole sheet read as blank.

### Trap 3 — use a fitted line, not the endpoints

Reading the bar's x off the *first* tracked row put it at x=426 when the bar was at
x=152, because that one row was a stray. A least-squares fit over hundreds of rows is
barely moved by a handful of outliers.

### Trap 4 — make the bars taller than the grid border

If the anchor bars span the answer grid *exactly*, they are the same height as the
grid's own left and right border rules, and which one the detector finds is decided by
antialiasing noise. Overhang the grid by ~2% at each end so the bars are unambiguously
the tallest vertical runs on the sheet.

---

## 4. Find the row positions — **measure, never compute**

This is the single highest-value step. Three sources, best first; each is validated
before use, and a wrong row position is far worse than an approximate one because it
reads a real answer off the wrong line and looks confident doing it.

### 4a. Timing ticks (best)

A short solid mark in the gutter beside every row, with blank paper around it. That
isolation is the whole point — every other row feature has neighbours to be confused
with.

```
project the tick column's x through the anchors, at BOTH the top and bottom of the
  grid, and take the union  (on a tilted page the tick column leans)
for each scan row: find the longest dark RUN inside that band
  a row is "inked" if that run is about as wide as a tick
collapse runs of inked rows to centres: one per tick
if centres == rowCount: done
if a few extra: slide a window of rowCount over them, keep the one whose gaps vary
  least, and accept only if the worst gap deviates < 25% from the mean
```

**Score by run width, not by what fraction of the band is dark.** The band must be
wide enough to cover a leaning tick column, and over that width one tick no longer
fills half of it — a fraction test found 4 inked rows out of 225 at 1° of tilt. Widen
the fraction threshold instead and the anchor bar's ends creep in, giving 17 centres
where there are 15 ticks. A run of the right width is what a tick actually *is*.

**Expect a couple of intruders and filter them out.** The even-spacing window above
recovers the real run without needing a perfectly clean band.

Measured: ticks give **15/15 at 0°, 1°, 2° and 3°** where the same sheet without them
falls to 6/15 at 5°.

### 4b. Table rules (fallback)

```
between the two bars, well inside them (inset ~5% of width each side):
    for each scan row y:
        darkFraction = proportion of sampled pixels that are dark
        if darkFraction > 0.6:  record y as a rule hit
collapse clusters of adjacent hits (a printed rule lands on 1-3 scan rows)
```

Then fit a **uniform** pitch to the rules found:

```
gaps        = differences between consecutive rules
medianGap   = median(gaps)                    # NOT (last-first)/count — see Trap 6
index each rule as round((y - first) / medianGap)
least-squares fit  y = originY + pitch * index
row k's centre = originY + pitch * (k + 0.5)
```

Accept the fit only if it explains the rules it was built from:

- **median** residual < 0.2 × pitch (median, not max — see Trap 7)
- measured pitch within 0.5×–2× of the projected pitch (rejects a fit built from the
  wrong features entirely)

If either check fails, fall back to the projected positions from §5.

### Trap 5 — why this step exists at all

The tempting shortcut is to compute row positions from where the answer grid *should*
start, derived from the header's height. That height is a sum of estimates — how tall a
declaration wrapped, how much room the identity block took, what the fonts did — and it cannot
be right.

Measured on a real sheet: the estimate predicted a **41.6px** row pitch where the page
printed **33.9px**. A 23% error, accumulating down the page:

| Row | Drift |
|---|---|
| 1 | 32px |
| 8 | 69px (≈ 2 rows) |
| 15 | 101px (≈ 3 rows) |

By question 8 the sampling had slid past half a row, so every answer below that was read
from the wrong line. The symptom looked like random wrong answers; it was a scale error.

### Trap 5b — a measured row corrects the row's POSITION, not just its y

Substituting a measured y while keeping the projected x is wrong on a tilted page: the
two axes are coupled, so pairing one row's x with another row's y walks the sample
sideways and the error grows with the angle. Ticks were being found correctly at every
angle and accuracy still fell to **1/15 at 5°** until the whole row was shifted by the
difference:

```
rowAnchor = project(row.cellLeft, row.y)
yShift    = measuredY - rowAnchor.y
sample at (point.x, point.y + yShift)      # NOT (point.x, measuredY)
```

### Trap 6 — derive the pitch from the median gap

A real rule list is imperfect. Measured on one sheet: a doubled rule at the table's
heavier top border (a 51px gap where the pitch was 35px), and one interior rule that
fell under threshold (a 71px gap, two rows wide).

Computing the pitch as `(last - first) / (count - 1)` folds both defects into the
estimate — it came out at 38.7px against a true 35.7px, which snapped two different
rules onto the same row index and corrupted the fit. The median gap ignores both.

### Trap 7 — judge the fit by the *median* residual

The table's heavier top border reliably sits ~35% of a pitch off the grid, while every
other rule lands within 15%. Judging by the worst residual throws away a perfectly good
fit because of that one known outlier.

---

## 5. Project bubble positions (fallback, and for x)

Row *y* comes from §4 when available. The *x* of each bubble, and *y* when no rules were
readable, come from a projection anchored on the bars:

```
u = (bubbleX - leftAnchorXFraction) / (rightAnchorXFraction - leftAnchorXFraction)
v = (bubbleY - anchorTopFraction)   / (anchorBottomFraction - anchorTopFraction)

dx = rightBarPixelX - leftBarPixelX
dy = rightBarPixelTop - leftBarPixelTop         # the tilt
skew = atan2(dy, dx)
barHeight = measured pixel height of the bars

x = leftBarPixelX  + u*dx - v*barHeight*sin(skew)
y = leftBarPixelTop + u*dy + v*barHeight*cos(skew)
```

### Trap 8 — the map must rotate

Two independent axis functions (`toPixelX(f)`, `toPixelY(f)`) cannot express rotation: a
point's x depends on its y on a tilted page. With separable axes, early columns read
correctly and later ones drift — exactly the pattern a real scan showed. One 2-D
projection, as above, is required.

---

## 6. Sample each bubble

```
r = bubbleRadius * 0.6                    # inset, to clear the printed ring
darkness = mean(1 - luminance) over the square box of half-width r
```

A square box rather than a true circle: the corner pixels shift every bubble equally, so
they cannot change which one wins, and it is far cheaper.

---

## 7. Decide the answer — compare against the row, not a constant

```
baseline = median(darkness across the row's choices)
excess[i] = darkness[i] - baseline

if max(excess) < MARK_EXCESS:                      -> blank
if runnerUpExcess >= bestExcess * 0.75:            -> multiple  (ambiguous)
else:                                              -> that choice
     flag "faint" if bestExcess < FAINT_EXCESS
```

Thresholds that worked: `MARK_EXCESS = 0.10`, `FAINT_EXCESS = 0.30`.

### Trap 9 — an absolute darkness threshold cannot work

The first implementation required `darkness > 0.35`. Measured:

| Mark style | Mean darkness |
|---|---|
| Solid fill | 1.00 |
| Ring + letter (a *traced* circle) | 0.20 |
| Bare printed circle (empty) | 0.16 |

A traced mark and an empty bubble are 0.04 apart. No absolute threshold separates them,
and lowering the bar to catch the trace makes every *empty* printed circle read as
marked.

The median of the row is the fix. With five choices and one marked, the median sits
among the unmarked ones — giving a per-row, per-scan, per-ink reading of "what a blank
bubble looks like here", which subtracts out paper tone, scanner exposure, ink colour
and the printed circle's own ink. All of those vary; none of them can be known in
advance.

### Trap 10 — put the threshold above the noise floor, not on it

`MARK_EXCESS` was first set to 0.04. Measured on a real scan, a genuinely **blank** row's
five bubbles differ by up to 0.040 from paper grain and the circles' own ink. The
threshold sat exactly on the noise floor, so a deliberately empty row read as
`multiple` — the detector finding a winner in grain.

A real mark clears its row's median by **0.57–0.76**. The gap between noise (0.04) and
ink (0.57) is enormous; anywhere in 0.06–0.4 separates them. 0.10 is comfortable.

### The honest limit

A *traced* ring (outline only, white centre) and a blank row are the same signal, ~0.04
either way. **No threshold separates them.** The choice is which way to fail, and blank
is safer: a student who shades as instructed is read correctly either way, whereas
treating noise as a mark invents answers on empty rows. Say "fill completely" on the
sheet and accept that an outlined circle reads blank and surfaces for review.

---

## 8. Score

```
blank, wrong, and ambiguous all score zero
an unkeyed question can never be correct
score = correctCount * pointsPerQuestion
```

Always show every detected mark for confirmation before saving. A grader that silently
guesses a test score is worse than no grader. Flag `blank`, `multiple` and `faint` rows
explicitly.

---

## 9. Corner fiducials

**Four solid black squares**, one in each margin corner.

Why they beat the anchor bars: a bar flanks the *answer grid*, so where it sits depends
on the header's height — which is estimated from which options are switched on and
cannot be right. A corner square is page-absolute. Nothing about it depends on the
header, the declaration's length, the identity block or the question count.

**Four, not three.** Three is the minimum for scale and rotation, and three placed
asymmetrically also name the page's orientation — but four gives the four point
correspondences a full perspective correction needs, which is what a phone photograph
requires, and it survives one corner being smudged or cropped. Orientation is then
recovered from ink distribution instead: an upright sheet carries its header, identity block
and answer table in the top half, so mass top-against-bottom separates 0° from 180°,
and the page's aspect separates portrait from landscape.

**Squares, not L-shapes or triangles.** The detector finds these by centre of mass, so
ink is signal. Measured at the size printed here, a solid triangle carries about twice
an L's ink (820px against 400px) and a square twice as much again. All four squares
located to within **0.8px** in testing; the L-shapes managed 1px and the triangles
0.6px, but a square is also the easiest shape to print crisply and to reason about.

Find each by centre of mass within a search box sized from the mark's own dimensions,
then subtract the corner-to-centroid offset — **half of each side for a square**. (It
was a third for a triangle and an ink-weighted average of two strokes for an L: the
offset follows the shape, and getting it wrong moves every sampled point.)

```
spanX = topRightXFraction - topLeftXFraction
axisX = (topRightPixel - topLeftPixel) / spanX      # vector, both components
axisY = (bottomLeftPixel - topLeftPixel) / spanY

point(xf, yf) = topLeftPixel + (xf - tlx)*axisX + (yf - tly)*axisY
```

This handles rotation, uniform scale, a cropped margin and a non-square aspect ratio at
once, because none of them was assumed. With all four corners it extends to a full
perspective transform, which is the step a phone photograph needs.

### Trap 11 — keep the search box clear of everything else

The bottom-left box initially reached 200px past its mark, swallowing the grid's bottom
rule and the anchor bars' lower ends — several times a fiducial's worth of ink, so the
sanity check rejected the mark and the sheet silently fell back to the anchor bars the
corners were meant to replace. Size the box from the mark's own dimensions, and stop
the anchor bars short of it.

### Trap 12 — the ink-area check must match the shape

The sanity check compares found ink against what the shape should contain. A square
covers its whole bounding box; a right triangle covers half of it; an L covers only its
two strokes. Carrying the wrong expectation forward when the shape changes rejects
every mark, which reads as "no fiducials on this sheet" rather than as a bug.

---

## 9a. Student identity: a QR code, not a bubble grid

The identity block is the one place on the sheet where being **confidently wrong** is
worse than failing. A misread answer costs one mark; a misread ID attaches a whole
paper to the wrong person.

### Why the bubble grid was replaced

The first implementation pre-shaded a 5x10 grid of digit bubbles (five columns, 0-9
down each). It worked, and it was wrong for the job:

- **No error detection.** A crease, a staple shadow or a coffee ring through one column
  does not produce a failure, it produces a *different valid ID*.
- **No landmark of its own.** The detector located it by finding a thin rectangle — the
  weakest feature on a page that also contains a bordered answer table and a bordered
  declaration box.
- **Digits only.** `S-2019` and `2019` encoded identically, so two students whose ids
  differ by a prefix collided silently.
- **Expensive.** Fifty bubbles plus a caption cost ~0.155 of the page height.

A QR fixes all four. It carries three finder patterns, so it self-locates and
self-deskews at any rotation. Reed-Solomon error correction means damage either decodes
correctly or fails loudly. It holds arbitrary text. And at the printed size it costs
~0.081 of the page — roughly half.

### What to print

| Property | Value | Why |
|---|---|---|
| Payload | `MHB-S:<id>` | The prefix rejects a foreign QR (a library sticker, a shipping label) rather than reading it as an id |
| Content | Student id **only** | Not the name: it is already printed in plain text beside the code, and it would push the symbol to a denser version with smaller modules. Not the exam id: grading already knows which exam it is running |
| Error correction | M (~15%) | L allows a smaller symbol but the sheet is handled, folded and photographed. H raises the module count, shrinking each module at a fixed printed size — that hurts more than the redundancy helps |
| Printed size | 0.105 of page **width** (~0.76in) | ~228px at 300dpi; ~10.8px per module for a 21x21 symbol, well above the 3-4 jsQR needs |
| Quiet zone | Drawn by the sheet, not the library | A doubled margin shrinks the modules for no gain |
| Format | SVG, **with `width`/`height` stripped** | Prints at the printer’s resolution, not the image’s, and needs no canvas during server rendering. The generator hardcodes `width="256"`; an SVG with intrinsic dimensions ignores its container, so leaving them in printed the code at a third of the page width, through the header and into the answer grid. The `viewBox` carries the geometry |

**The square trap, again.** The symbol must be square *on paper*. A width fraction and
a height fraction are different distances: on 8.5x11, `0.105` of the width is `0.081` of
the height, so converting means **multiplying** by `width/height`. Dividing makes it
taller. This is the third time this exact error has shipped in this codebase — the
corner fiducials printed as 23.5pt x 19.6pt rectangles for the same reason — and it was
caught here only by a unit test asserting the crop comes out square in pixels. Write
that test.

### How to read it

1. **Crop first, decode second.** Hand the decoder only the QR block, located from the
   shared layout. Do not scan the whole page: the four corner fiducials are solid black
   squares and look enough like finder patterns to send the decoder hunting through
   them. The crop also cuts the work by ~99%.
2. **Pad the crop generously** — 75% of the code's size on each side, not 25%. The
   block's position comes from an *estimate* of where the header ended, and a QR
   clipped on one edge loses a finder pattern and fails completely: there is no partial
   decode. Padding is nearly free, because the crop is ~1% of the page either way and
   the decoder ignores surrounding white. Expect the crop to **clamp** at the page edge
   on the side the code sits near, and do not assert symmetric padding anywhere.
3. **Locate it with a measured height, never a budgeted one.** This is the subtle one,
   and it cost a working decoder. The header's height is used for two different jobs:
   *reserving* space (so the answer grid starts below it) and *locating* the QR inside
   it. The reserve figure is deliberately padded upward, because over-reserving only
   wastes paper while under-reserving draws the grid on top of the header. Deriving the
   QR's position from that padded number put the crop 38px low, clipped 16px off an
   89px code, and took both upper finder patterns with it. Every sheet then failed to
   decode and fell back to file-name matching — and **nothing looked broken**, because
   the fallback is silent and plausible. Keep two constants: one budgeted, one measured.
4. **Try both polarities.** A sheet is normally dark-on-light, but a photocopier or a
   scanner set to "black and white" can inverse it. One extra pass over a small crop.
5. **Validate the payload.** Check the prefix, then check the id against the roster.
   An id that decodes cleanly but is not on this roster (a sheet from another class, a
   stale printout) must fall back, not be trusted.
6. **Never let a failure fail the grading.** The sheet still grades; identity falls back
   to matching the file name. Report *how* the student was identified so the operator
   can see which rows deserve a second look.

### Measured limits

Generated with `qrcode`, decoded with `jsQR`, rendered through `sharp` at the size a
1700px page scan produces (~170px):

| Condition | Result |
|---|---|
| 170px (normal page scan) | PASS |
| 120px / 90px | PASS |
| 2° and 5° tilt | PASS |
| Gaussian blur (phone photo) | PASS |
| JPEG quality 50 | PASS |
| Inverted (b&w scanner) | PASS |
| Full-page crop via the real crop path | PASS |
| Full page at 1700px, code at its printed position | PASS |
| Same, with the position estimate 0.02 of page height HIGH | PASS |
| Same, 0.02 LOW | PASS |
| Contrast below ~2.9:1 | **FAIL** |

The three position rows are what the 75% padding buys: a crop built from a wrong
estimate still contains the code. At 25% padding the last three rows all failed.

The contrast floor is the only failure found. It corresponds to a page so faded — dark
ink at ~100/255 against ~228/255 paper — that a human would reject it too. A normally
printed sheet is 20:1 or better. If it matters, the fix is a local adaptive threshold
before decoding, not a bigger symbol.

**Still unproven:** none of the above is a photograph of a real printed sheet. Every
result here is synthetic.

---

## 10. What to verify, and how

Synthetic bitmaps are necessary but **not sufficient**. Every bug in this document
survived a green synthetic suite and was found only on a real scan. Build both:

- **Synthetic**: render a sheet from the *same* layout function the printer uses, shade
  known answers, read it back. Vary tilt (−3° to +5°), choice count, question count,
  header height, and image scale.
- **Real**: scan a sheet with deliberate edge cases — one row left blank, one row
  double-marked, one light mark — and assert the exact expected read-out.
- **Feed the test the same estimate the app will.** The QR decoder passed a synthetic
  end-to-end test -- render a full page, crop, decode -- while being broken in
  production, because the test handed the crop the *correct* position and the app
  handed it a padded one. A test that supplies ideal inputs only proves the maths, not
  the wiring. Assert against the value the caller actually computes.

Keep a tilt ladder as a regression test. It is the single most informative fixture:
a detector that reads 0° correctly and 2° wrongly has a geometry bug, not a threshold
bug.

---

## 11. Known gaps in the reference implementation

Stated plainly, because a method document that only describes the happy path is a
sales pitch.

- **The corner path is wired but unproven on paper.** Four squares are detected to
  0.8px on synthetic renders, but the only real scan available predates them, so
  `cornersFound` is 0 on it. The 15/15 result comes from anchor bars (§3) plus measured
  row rules (§4a/4b). The search box also needs to handle running past the image
  boundary — a scan that crops the top edge put one centroid off-page.
- **No perspective correction.** Rotation and uniform scale only. Four fiducials make
  the full transform possible; it is not built. A phone photograph needs it.
- **No orientation detection.** A sheet fed in at 90/180/270° is read as-is and graded
  confidently wrong. The ink-distribution method in §9 is designed but not implemented.
- **Multi-column tick-finding is unreliable past ~40 questions**, which is why §1 caps
  a sheet at 30. Within the cap it reads 30/30.
- **The QR has never been read off paper.** Every result in §9a is synthetic:
  generated, rendered and decoded in memory, including the full-page runs at the real
  printed position. It has not been printed, scanned and decoded end to end. The one
  thing that would confirm it is a named sheet whose grader row reads "matched by QR
  code" rather than "guessed from file name".
- **The question-number cell is wider than a choice cell**, 1.41x on a sparse sheet.
  The layout declares a cap for it (`MAX_LABEL_WIDTH`) and documents it as applied --
  it is not. Applying it equalises the row and breaks the detector: column A reads
  pure white on every synthetic sheet, with `rowSource: "projected"`. The projection
  fallback evidently carries its own assumption about where the bubble band starts,
  independent of the shared `bubble.x`. Find that before applying the cap. A cosmetic
  flaw currently guarding a correctness one.
- **Choice spacing varies with layout** — the gap between A and B is 223px on a
  ten-question sheet and 89px on a dense one. A fixed pitch is better for readers and
  for the detector, but it must be expressed relative to the COLUMN, not the page:
  expressed as a page fraction it put bubbles at different relative positions on
  canvases of different widths and column A read pure white.

---

## Summary of measured constants

| Constant | Value | Why |
|---|---|---|
| Scan longest edge | 1700px | Bubble ~44px; grain averaged away |
| Dark pixel | `1 - luminance > 0.5` | |
| Bar run bounds | 3px .. 3.5% of width | Floor rejects rules; ceiling rejects table rules |
| Bar trace gap tolerance | 1% of height | Noise skips rows; a bar is continuous |
| Rule detection | `darkFraction > 0.6` | A rule spans the table; bubbles do not |
| Rule fit residual | median < 0.2 × pitch | Median ignores the doubled top border |
| Pitch sanity | 0.5× .. 2× projected | Rejects a fit built from the wrong features |
| Sample inset | 0.6 × radius | Clears the printed ring |
| Bubble outline | `#CCCCCC` (darkness 0.20) | Under the ink threshold; keeps the empty baseline near paper-white |
| Bubble shape | 1.67:1 pill, ~10pt × 6pt | Filled by one stroke; fewer partial fills |
| Corner fiducial | solid square, 0.045 × 0.028 | Most ink per footprint; centroid at half each side |
| Questions per sheet | 30 | Detector, not paper — see §1 |
| QR size | 0.105 of page WIDTH | ~10.8px per module at 300dpi |
| QR error correction | M (~15%) | Survives handling without shrinking modules |
| QR crop padding | 75% each side | A clipped finder pattern fails the whole decode; absorbs a wrong header estimate |
| QR contrast floor | ~2.9:1 | Below this jsQR finds nothing |
| `MARK_EXCESS` | 0.10 | Noise floor 0.04; real marks 0.57+ |
| `FAINT_EXCESS` | 0.30 | Below this, worth a human look |
| Ambiguity ratio | 0.75 | Runner-up this close is a guess |
