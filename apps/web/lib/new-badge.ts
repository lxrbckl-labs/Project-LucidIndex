/**
 * "New article" badge helpers (#79).
 *
 * The dashboard tile and article header render a small "NEW" pill when
 * the article was inserted within the configured window — measured from
 * `articles.created_at` (the agent-insertion timestamp, NOT the source
 * publish date — the spec is explicit on this).
 *
 * The window is `settings.new_article_badge_hours` (default 24 — the
 * column default in `packages/db/schema/agent.ts`). Admin-tunable from
 * Settings → System (or whichever panel adopts the lever — surfacing
 * the field is out of scope for this PR; the read path is here).
 *
 * Caching: server components render many cards in a single request and
 * we don't want to round-trip to the DB per card. A 60s in-process
 * cache is plenty — the badge window is in hours, so a stale-by-a-
 * minute read can never flip a card from "new" to "not new" or vice
 * versa in a way that surprises a user.
 *
 * Mock-mode shortcut: when `LUCIDINDEX_MOCK=1` is set we skip the DB
 * read entirely and return the schema default (24h). Mock-mode runs
 * against a flag-driven dev server that may have no DB at all (the
 * Phase 5 visual gate ran exactly this way).
 */

import { db } from '@lucidindex/db/client'
import { settings } from '@lucidindex/db/schema'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

/** Schema default — keep in sync with `settings.new_article_badge_hours`. */
export const DEFAULT_NEW_BADGE_HOURS = 24

const CACHE_TTL_MS = 60_000

let cachedHours: number | null = null
let cacheTime = 0

/**
 * Return the "NEW" badge window in hours, reading the singleton settings
 * row (with a 60s in-process cache). Falls back to {@link DEFAULT_NEW_BADGE_HOURS}
 * when the singleton row hasn't been initialized yet (fresh install) —
 * matches the column default and keeps the badge behavior predictable.
 */
export async function getNewBadgeHours(): Promise<number> {
  if (MOCK_MODE) return DEFAULT_NEW_BADGE_HOURS

  const now = Date.now()
  if (cachedHours !== null && now - cacheTime < CACHE_TTL_MS) {
    return cachedHours
  }

  try {
    const rows = await db.select({ h: settings.newArticleBadgeHours }).from(settings).limit(1)
    const value = rows[0]?.h ?? DEFAULT_NEW_BADGE_HOURS
    cachedHours = value
    cacheTime = now
    return value
  } catch {
    // Fresh install / migration not yet applied / settings row missing:
    // don't take the dashboard down over a missing config row.
    return DEFAULT_NEW_BADGE_HOURS
  }
}

/**
 * Pure, side-effect-free predicate. Returns true when `createdAt` is
 * within the badge window measured from "now". Compares against
 * `Date.now()` so the test seam is straightforward — pass a fixed
 * `createdAt` close to or far from now to exercise both branches.
 *
 * `badgeHours <= 0` disables the badge entirely (admin can dial it to
 * zero to opt out without removing the UI).
 */
export function isNew(createdAt: Date, badgeHours: number): boolean {
  if (!Number.isFinite(badgeHours) || badgeHours <= 0) return false
  const ageMs = Date.now() - createdAt.getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return false
  return ageMs < badgeHours * 60 * 60 * 1000
}

/** Test seam — bust the cache between tests. Not exported via barrel. */
export function _resetNewBadgeCache(): void {
  cachedHours = null
  cacheTime = 0
}
