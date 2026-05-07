/**
 * Bearish→Bullish sentiment gauge for the creator card.
 *
 * Three-row metric block:
 *   Row 1 — tick labels above the bar (Bearish / Neutral / Bullish)
 *   Row 2 — the bar with a vertical marker plotted at the average
 *   Row 3 — caption (Avg X.X · N articles)
 *
 * Hidden by the parent (`count >= 3`) so a one-off rating doesn't render
 * a misleading gauge — see CreatorSentiment in loader.ts.
 */

type Props = {
  averageSentiment: number
  count: number
}

const RANGE = 10 // -5 to +5 spans 10 units

export function SentimentGauge({ averageSentiment, count: _count }: Props) {
  // Clamp + map to 0..1 for the % offset on the track.
  const clamped = Math.max(-5, Math.min(5, averageSentiment))
  const offsetPct = ((clamped + 5) / RANGE) * 100

  return (
    <div
      role="img"
      aria-label="Average sentiment across articles"
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <span>Bearish</span>
        <span>Bullish</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-emerald-500 via-zinc-300 to-rose-400">
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-0.5 bg-foreground rounded-full shadow-sm"
          style={{ left: `${offsetPct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
