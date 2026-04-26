/**
 * NewBadge — small "NEW" pill (#79).
 *
 * Rendered next to the date pill on dashboard tiles and in the article
 * page header when the article was inserted within the configured
 * window (`settings.new_article_badge_hours`, default 24h, measured
 * from `articles.created_at`).
 *
 * Visual treatment:
 *   - Pill shape (`--radius-pill`) — matches the date / topic-badge pills.
 *   - Inverted fill (ink background, paper text) — distinct from the
 *     hairline-bordered pills so the affordance reads at a glance
 *     without being loud.
 *   - Same typography as the topic-badge pill (uppercase tracking) so
 *     the chrome stays consistent.
 *
 * Server component — pure render, no client state. Visibility is the
 * caller's responsibility (the parent decides whether to render based
 * on `isNew(createdAt, badgeHours)`).
 */

type Props = {
  /** Optional override for the variant — `light` for dark backgrounds (large tile overlay). */
  variant?: 'default' | 'light'
}

export function NewBadge({ variant = 'default' }: Props) {
  const className =
    variant === 'light'
      ? 'inline-flex items-center justify-center border border-paper bg-paper px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink'
      : 'inline-flex items-center justify-center border border-ink bg-ink px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-paper'

  return (
    <span
      className={className}
      style={{ borderRadius: 'var(--radius-pill)' }}
      data-testid="new-badge"
    >
      NEW
    </span>
  )
}
