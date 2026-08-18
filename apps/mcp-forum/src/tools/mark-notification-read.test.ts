/**
 * Tests for `mark_notification_read`.
 *
 * Coverage:
 *   1. Happy path — flips read_at, returns was_already_read=false.
 *   2. Idempotent — re-marking returns was_already_read=true with the
 *      ORIGINAL read_at (not the new one).
 *   3. Wrong-owner — rejecting with `notification_not_found` when the
 *      row belongs to a different recipient.
 *
 * Harness mirrors `create-post.test.ts`.
 */

import { forumPosts, forumUsers, notifications } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('markNotificationRead (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let markNotificationRead: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./mark-notification-read.js')
    markNotificationRead = mod.markNotificationRead
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

  async function seedPost(authorId: string): Promise<string> {
    const rows = await db
      .insert(forumPosts)
      .values({ authorId, title: 't', body: 'b' })
      .returning({ id: forumPosts.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  async function seedNotificationFor(recipient: string, actor: string, post: string) {
    const rows = await db
      .insert(notifications)
      .values({
        recipientUserId: recipient,
        actorUserId: actor,
        sourcePostId: post,
        kind: 'mentioned_in_post',
      })
      .returning({ id: notifications.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  it('flips read_at on first call and reports was_already_read=false', async () => {
    const me = await seedUser('mep')
    const them = await seedUser('them')
    const post = await seedPost(them)
    const id = await seedNotificationFor(me, them, post)

    const result = await markNotificationRead({
      notification_id: id,
      forumUserId: me,
      username: 'mep',
    })
    expect(result.ok).toBe(true)
    expect(result.was_already_read).toBe(false)
    expect(result.read_at).toMatch(/^\d{4}-/)

    // Verify the row's read_at is now non-null.
    const stored = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, id))
    expect(stored[0]?.readAt).not.toBeNull()
  })

  it('is idempotent — re-marking returns was_already_read=true with the ORIGINAL read_at', async () => {
    const me = await seedUser('mep')
    const them = await seedUser('them')
    const post = await seedPost(them)
    const id = await seedNotificationFor(me, them, post)

    const first = await markNotificationRead({
      notification_id: id,
      forumUserId: me,
      username: 'mep',
    })
    // Force a small delay so a buggy implementation that overwrites
    // read_at would produce a different timestamp on re-mark.
    await new Promise((r) => setTimeout(r, 20))
    const second = await markNotificationRead({
      notification_id: id,
      forumUserId: me,
      username: 'mep',
    })
    expect(second.was_already_read).toBe(true)
    expect(second.read_at).toBe(first.read_at)
  })

  it('rejects with notification_not_found when the row belongs to another user', async () => {
    const me = await seedUser('mep')
    const other = await seedUser('other')
    const them = await seedUser('them')
    const post = await seedPost(them)
    // Notification is OTHER's, not mine.
    const id = await seedNotificationFor(other, them, post)

    await expect(
      markNotificationRead({
        notification_id: id,
        forumUserId: me,
        username: 'mep',
      }),
    ).rejects.toMatchObject({ code: 'notification_not_found' })
  })
})
