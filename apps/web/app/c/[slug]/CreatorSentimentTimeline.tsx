/**
 * CreatorSentimentTimeline — hand-rolled SVG line chart of a creator's
 * weekly average sentiment over the trailing 52 weeks.
 *
 * Server component, static (no interactivity in v1) — mirrors the house
 * hand-rolled-SVG style of `SentimentGauge` and colors everything from
 * theme tokens (via `currentColor`) so it reads correctly in light and
 * dark. Deliberately minimal: no gridlines, no axis labels, no point
 * markers — just a smooth curve through the weekly values (Catmull-Rom
 * spline converted to cubic Bezier segments) over a faint dashed median
 * line.
 *
 *   X axis — time, ~52-weeks-ago (left) → now (right). Each week is
 *            positioned by its real date against a [now-52w, now] domain,
 *            so gaps between populated weeks show as spacing.
 *   Y axis — sentiment, native −5…+5. Unlabeled; position only.
 *
 * Empty in-window data renders a muted placeholder instead of an axis
 * with no line. A single populated week renders as a short tick (a
 * smooth curve needs ≥2 points).
 *
 * Bare markup (no Card wrapper) — this renders inside a band in
 * `CreatorProfileTile`, a ~320–360px-wide column, not as a standalone
 * full-width card. Geometry below is tuned for that narrow width.
 */

import type { CreatorSentimentWeek } from './loader'

type Props = {
  data: CreatorSentimentWeek[]
}

// viewBox geometry. The SVG uses width:100% + a fixed pixel height with
// `preserveAspectRatio="none"`, so the 340x80 viewBox stretches to fill the
// full width of its container at any card width (vertical scale stays
// fixed). No labels are drawn horizontally, so the plot spans the full
// viewBox width — this keeps the curve's left/right edges flush with the
// "Sentiment Analysis" label above it (both live inside the same `px-6`
// band in the parent).
const VB_W = 340
const VB_H = 80
const PAD_X = 0
const PAD_Y = 0
const PLOT_W = VB_W - PAD_X * 2
const PLOT_H = VB_H - PAD_Y * 2

const WEEKS = 52
const WINDOW_MS = WEEKS * 7 * 24 * 60 * 60 * 1000

// Native sentiment range.
const Y_MIN = -5
const Y_MAX = 5

/** Map a sentiment value (−5…+5) to a y pixel in the plot area. */
function yFor(value: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, value))
  return PAD_Y + ((Y_MAX - clamped) / (Y_MAX - Y_MIN)) * PLOT_H
}

/** Map a timestamp to an x pixel across the [now−52w, now] domain. */
function xFor(ms: number, startMs: number, endMs: number): number {
  const t = (ms - startMs) / (endMs - startMs)
  const clamped = Math.max(0, Math.min(1, t))
  return PAD_X + clamped * PLOT_W
}

/**
 * Median of a numeric list. Sorts a copy, returns the middle element for
 * odd lengths and the mean of the two middle elements for even lengths.
 * Assumes a non-empty input (callers gate on `data.length > 0`).
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

type Point = { x: number; y: number }

/**
 * Build a smooth SVG path through `points` using a uniform Catmull-Rom
 * spline (tension ~0.5) converted to cubic-Bezier segments — one `C`
 * command per gap between points, with control points derived from each
 * point's neighbors (falling back to the point itself at the ends).
 */
function smoothPath(points: Point[]): string {
  const first = points[0]
  if (!first) return ''
  let d = `M ${first.x} ${first.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (!p1 || !p2) continue
    const p0 = points[i - 1] ?? p1
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

export function CreatorSentimentTimeline({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="py-6 flex items-center justify-center">
        <p className="text-sm text-muted-foreground italic">Not enough sentiment data yet</p>
      </div>
    )
  }

  const endMs = Date.now()
  const startMs = endMs - WINDOW_MS

  const points = data.map((d) => ({
    key: d.weekStart,
    x: xFor(new Date(d.weekStart).getTime(), startMs, endMs),
    y: yFor(d.avgSentiment),
  }))

  // `data.length === 0` returns early above, so `points` always has at
  // least one entry here — used by the single-point tick fallback below.
  const [firstPoint] = points
  if (!firstPoint) return null

  // Median of the plotted weekly values, drawn as a faint dashed reference
  // line behind the curve. `data.length > 0` is guaranteed here.
  const medianY = yFor(median(data.map((d) => d.avgSentiment)))

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        Sentiment Analysis
      </span>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height={VB_H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Average sentiment per week over the past year"
        className="overflow-visible"
      >
        {/* Faint dashed median reference line — behind the data curve.
            Rendered first so the data curve sits on top. */}
        <line
          x1={PAD_X}
          y1={medianY}
          x2={VB_W - PAD_X}
          y2={medianY}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          className="text-muted-foreground"
        />

        {points.length > 1 ? (
          // Smooth Catmull-Rom curve — 2px, rounded caps/joins, theme primary.
          <path
            d={smoothPath(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          />
        ) : (
          // Single populated week — a smooth curve needs ≥2 points, so
          // render a short horizontal tick instead of a bare dot.
          <line
            x1={firstPoint.x - 3}
            y1={firstPoint.y}
            x2={firstPoint.x + 3}
            y2={firstPoint.y}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="text-primary"
          />
        )}
      </svg>
    </div>
  )
}
