/**
 * Tests for `get_topic_badges` — the forum-side topic-badge discovery
 * surface. Mirrors the dashboard-side test for the equivalent tool;
 * the only behavior difference is that the forum surface exposes
 * `id` alongside `name` + `display_order` (the dashboard surface
 * omits id because its caller — write_articles — keys on badge name).
 *
 * Test harness: same shape as `create-post.test.ts` — `makeTestDb()`
 * + `truncateAllTables()` + `resolveTestDatabaseUrl()`. Gated on
 * `DATABASE_URL_TEST` (or a `lucidindex_test` DB at the same host as
 * `DATABASE_URL`).
 */

import { topicBadges } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('getTopicBadges (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let getTopicBadges: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./get-topic-badges.js')
    getTopicBadges = mod.getTopicBadges
  })

  afterAll(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: postgres-js handle
    await (db as any).$client?.end?.({ timeout: 1 })
  })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  it('returns an empty list when no badges exist', async () => {
    const result = await getTopicBadges()
    expect(result).toEqual({ badges: [] })
  })

  it('returns visible badges ordered by display_order then name; excludes hidden', async () => {
    // Seed a small mixed taxonomy. `Zeta` should come BEFORE `Alpha`
    // because it has a lower display_order; the two display_order=10
    // rows tie-break on name (`Alpha` before `Beta`); `Hidden` is
    // excluded entirely.
    await db.insert(topicBadges).values([
      { name: 'Zeta', displayOrder: 0, hidden: false },
      { name: 'Alpha', displayOrder: 10, hidden: false },
      { name: 'Beta', displayOrder: 10, hidden: false },
      { name: 'Hidden', displayOrder: 5, hidden: true },
    ])

    const result = await getTopicBadges()
    expect(result.badges).toHaveLength(3)
    expect(result.badges.map((b: { name: string }) => b.name)).toEqual(['Zeta', 'Alpha', 'Beta'])
    // Every row carries the badge UUID + the display_order.
    for (const b of result.badges) {
      expect(b.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(typeof b.display_order).toBe('number')
    }
  })
})
