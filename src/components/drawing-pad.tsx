"use client";

// A sheet of paper to draw on with a finger, a pen or a mouse, that hands back both
// the picture and the strokes that made it — so a drawing can be reopened and edited.
//
// Pure presentation: the palette, the sizes and the starting strokes come in as props,
// and the result goes out through `onSave`. What a drawing *means* (where it is stored,
// which inks are allowed) belongs to the caller — Clips validates it in
// `src/lib/clips/drawing.ts`.
//
// ## Why the strokes live in a ref
//
// The same reason Pictionary's board gives: a stroke is drawn straight onto the canvas
// as the pointer moves, and putting each point through React state would re-render the
// pad on every pointer move for no gain. The ref is the record; `strokeCount` is the
// only state, and exists so Undo knows whether it has anything to undo.
//
// ## Why a white sheet
//
// The drawing is content, not chrome. It is rasterised to a PNG that has to look the
// same under all eight themes, so the sheet and the inks are fixed colours supplied by
// the caller, not theme tokens — the same reasoning as Pictionary's board.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";

/** One pen stroke, in backing-store pixels. */
export interface DrawingPadStroke {
  /** A key from `inks`. */
  ink: string;
  size: number;
  /** Painted in `paperColor`, which is what makes the eraser need no compositing. */
  erase: boolean;
  points: [number, number][];
}

export interface DrawingPadInk {
  key: string;
  /** A literal colour: the drawing is content, see the note at the top. */
  color: string;
  /** For the swatch's accessible name. */
  label: string;
}

export interface DrawingPadResult {
  strokes: DrawingPadStroke[];
  /** The rendered sheet as PNG, base64 without the `data:` prefix. */
  pngBase64: string;
}

export interface DrawingPadProps {
  inks: DrawingPadInk[];
  /** Pen widths, thinnest first. The eraser uses the same widths. */
  sizes: readonly number[];
  paperColor: string;
  /** The backing store. The CSS box scales to fit but keeps this ratio. */
  width: number;
  height: number;
  /** Strokes to start from, when reopening a drawing. */
  initialStrokes?: DrawingPadStroke[];
  onSave: (result: DrawingPadResult) => void;
  onCancel?: () => void;
  /** Disables the buttons while the caller stores the result. */
  saving?: boolean;
  /** Shown under the toolbar, e.g. a refused save. */
  error?: string;
  className?: string;
}

export function DrawingPad({
  inks,
  sizes,
  paperColor,
  width,
  height,
  initialStrokes = [],
  onSave,
  onCancel,
  saving = false,
  error,
  className = "",
}: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<DrawingPadStroke[]>(initialStrokes.map(copyStroke));
  const currentRef = useRef<DrawingPadStroke | null>(null);
  const [strokeCount, setStrokeCount] = useState(initialStrokes.length);

  const [ink, setInk] = useState(inks[0]?.key ?? "");
  const [size, setSize] = useState<number>(sizes[1] ?? sizes[0] ?? 6);
  const [erasing, setErasing] = useState(false);

  const colorOf = useCallback(
    (stroke: DrawingPadStroke) =>
      stroke.erase ? paperColor : (inks.find((item) => item.key === stroke.ink)?.color ?? paperColor),
    [inks, paperColor],
  );

  /** Repaints the sheet from the record — after an undo, a clear, or on first mount. */
  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = paperColor;
    ctx.fillRect(0, 0, width, height);
    for (const stroke of strokesRef.current) paintStroke(ctx, stroke, colorOf(stroke));
  }, [colorOf, height, paperColor, width]);

  // The canvas is an external system, which is what an effect is for.
  useEffect(() => {
    redraw();
  }, [redraw]);

  /** A pointer event in backing-store coordinates, rounded to keep the JSON small. */
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>): [number, number] | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return undefined;
    return [
      Math.round(((event.clientX - box.left) / box.width) * width),
      Math.round(((event.clientY - box.top) / box.height) * height),
    ];
  }

  function handleDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (saving) return;
    const point = pointAt(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!point || !ctx) return;

    // Capture so a stroke that leaves the sheet mid-drag still ends — without it a
    // pointerup outside the element never arrives and the pen stays down.
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: DrawingPadStroke = { ink, size, erase: erasing, points: [point] };
    currentRef.current = stroke;
    paintStroke(ctx, stroke, colorOf(stroke));
  }

  function handleMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = currentRef.current;
    if (!stroke) return;
    const point = pointAt(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!point || !ctx) return;

    const last = stroke.points[stroke.points.length - 1];
    // Same pixel again: a point that adds nothing to the line only adds to the JSON.
    if (last[0] === point[0] && last[1] === point[1]) return;
    stroke.points.push(point);

    // Paint just the new segment; the rest of the stroke is already on the sheet.
    ctx.strokeStyle = colorOf(stroke);
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(point[0], point[1]);
    ctx.stroke();
  }

  function handleUp() {
    const stroke = currentRef.current;
    if (!stroke) return;
    currentRef.current = null;
    strokesRef.current.push(stroke);
    setStrokeCount(strokesRef.current.length);
  }

  function handleUndo() {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
  }

  function handleClear() {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave({
      strokes: strokesRef.current.map(copyStroke),
      pngBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    });
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        aria-label="Drawing sheet"
        // `touch-none` so a finger drag draws instead of scrolling the page.
        className="mx-auto h-auto w-full cursor-crosshair touch-none rounded-xl border border-line"
        style={{
          backgroundColor: paperColor,
          aspectRatio: `${width} / ${height}`,
          // Cap the WIDTH against the viewport height and let the ratio set the
          // height — capping the height on a `w-full` box squashes the CSS box away
          // from the backing store and strokes land off the fingertip (Pictionary
          // learnt this). The vh term keeps the toolbar on screen on a short window
          // or a phone held sideways.
          maxWidth: `min(100%, calc(min(40rem, 60vh) * ${width / height}))`,
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Pen colour" className="flex flex-wrap items-center gap-1">
          {inks.map((item) => {
            const active = !erasing && ink === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setInk(item.key);
                  setErasing(false);
                }}
                aria-label={item.label}
                aria-pressed={active}
                title={item.label}
                // The swatch is filled with the ink itself: it is showing the content
                // colour, not styling chrome.
                style={{ backgroundColor: item.color }}
                className={`h-7 w-7 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  active ? "border-brass ring-2 ring-brass" : "border-line"
                }`}
              />
            );
          })}
        </div>

        <div role="group" aria-label="Pen size" className="flex items-center gap-1">
          {sizes.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSize(value)}
              aria-label={`Size ${value}`}
              aria-pressed={size === value}
              title={`Size ${value}`}
              className={`flex h-7 w-7 items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                size === value ? "border-brass bg-paper-raised" : "border-line"
              }`}
            >
              <span
                aria-hidden
                className="rounded-full bg-ink"
                style={{ width: dotSize(value, sizes), height: dotSize(value, sizes) }}
              />
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant={erasing ? "primary" : "secondary"}
          onClick={() => setErasing((value) => !value)}
          ariaPressed={erasing}
        >
          Eraser
        </Button>
        <Button size="sm" variant="secondary" onClick={handleUndo} disabled={strokeCount === 0 || saving}>
          Undo
        </Button>
        <Button size="sm" variant="secondary" onClick={handleClear} disabled={strokeCount === 0 || saving}>
          Clear
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving || strokeCount === 0}>
          {saving ? "Saving…" : "Save drawing"}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function copyStroke(stroke: DrawingPadStroke): DrawingPadStroke {
  return { ...stroke, points: stroke.points.map(([x, y]) => [x, y] as [number, number]) };
}

/** Paints a whole stroke. A single point becomes a dot, so a tap leaves a mark. */
function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawingPadStroke, color: string) {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  if (rest.length === 0) ctx.lineTo(first[0] + 0.01, first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.stroke();
}

/** The size button's dot, scaled into the 28px button rather than drawn at true size. */
function dotSize(value: number, sizes: readonly number[]): number {
  const largest = Math.max(...sizes);
  return Math.max(3, Math.round((value / largest) * 18));
}
