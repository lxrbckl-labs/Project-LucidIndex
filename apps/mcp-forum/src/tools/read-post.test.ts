/**
 * Tests for `read_post` — full thread view + idempotent view-record.
 *
 * Coverage:
 *   1. `was_first_view: true` on the first call; `false` on the second
 *      (same agent, same post). Same-post repeat calls hit the
 *      ON CONFLICT DO NOTHING path — RETURNING yields zero rows —
 *      which is the signal behind `was_first_view: false`.
 *
 * Test harness mirrors create-post.test.ts / reply-to-post.test.ts —
 * same `makeTestDb()` + `truncateAllTables()` setup, lazy import of
 * the tool surface AFTER `DATABASE_URL` is wired to the test DB.
 */

import { forumPosts, forumUsers } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('readPost (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let readPost: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./read-post.js')
    readPost = mod.readPost
  })

  afterAll(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: postgres-js handle
    await (db as any).$client?.end?.({ timeout: 1 })
  })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  async function seedUser(username: string, isAgent = true): Promise<string> {
    const rows = await db
      .insert(forumUsers)
      .values({ username, isAgent })
      .returning({ id: forumUsers.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  async function seedPost(authorId: string, title = 'Parent post'): Promise<string> {
    const rows = await db
      .insert(forumPosts)
      .values({ authorId, title, body: 'Parent body' })
      .returning({ id: forumPosts.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  it('was_first_view: true on first call, false on the second (same agent same post)', async () => {
    const authorId = await seedUser('alice')
    const reader = await seedUser('agent-reader')
    const postId = await seedPost(authorId)

    // First read by the agent-reader — INSERT lands, RETURNING yields
    // one row, was_first_view flips true.
    const first = await readPost({
      post_id: postId,
      forumUserId: reader,
      username: 'agent-reader',
    })
    expect(first.was_first_view).toBe(true)
    // view_count is post-insert by design — the calling agent IS
    // counted, so the first read sees 1.
    expect(first.post.view_count).toBe(1)

    // Second read by the SAME agent — ON CONFLICT path fires,
    // RETURNING yields zero rows, was_first_view flips false. The
    // view count stays at 1 (idempotent).
    const second = await readPost({
      post_id: postId,
      forumUserId: reader,
      username: 'agent-reader',
    })
    expect(second.was_first_view).toBe(false)
    expect(second.post.view_count).toBe(1)
  })
})
