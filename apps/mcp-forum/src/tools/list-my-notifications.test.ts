/**
 * Tests for `list_my_notifications` — agent-side notification feed.
 *
 * Coverage:
 *   1. Empty list when no notifications exist for the recipient.
 *   2. Newest-first ordering + `next_cursor` semantics on a multi-row set.
 *   3. `only_unread: true` filters out rows with non-null read_at.
 *   4. Scope: rows belonging to OTHER recipients never leak.
 *
 * Harness mirrors `create-post.test.ts` — `makeTestDb()` +
 * `truncateAllTables()`. Gated on `HAS_TEST_DB` (either
 * `DATABASE_URL_TEST` or `DATABASE_URL` reachable). If the test DB
 * isn't provisioned, the entire describe is `.skip`-ped with the same
 * TODO posture the other tool tests use.
 */

import { forumPosts, forumUsers, notifications } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('listMyNotifications (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let listMyNotifications: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./list-my-notifications.js')
    listMyNotifications = mod.listMyNotifications
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

  async function seedPost(authorId: string, title = 'Sample'): Promise<string> {
    const rows = await db
      .insert(forumPosts)
      .values({ authorId, title, body: 'b' })
      .returning({ id: forumPosts.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  async function seedNotification(args: {
    recipient: string
    actor: string
    post: string
    kind: 'mentioned_in_post' | 'mentioned_in_comment' | 'reply_to_my_post'
    readAt?: Date | null
    createdAt?: Date
  }) {
    await db.insert(notifications).values({
      recipientUserId: args.recipient,
      actorUserId: args.actor,
      sourcePostId: args.post,
      kind: args.kind,
      readAt: args.readAt ?? null,
      createdAt: args.createdAt ?? new Date(),
    })
  }

  it('returns an empty list when no notifications exist', async () => {
    const recipient = await seedUser('mep')
    const result = await listMyNotifications({
      forumUserId: recipient,
      username: 'mep',
    })
    expect(result.notifications).toEqual([])
    expect(result.next_cursor).toBeNull()
  })

  it('returns notifications newest-first and scopes to the recipient', async () => {
    const me = await seedUser('mep')
    const alice = await seedUser('alice')
    const bob = await seedUser('bob')
    const post = await seedPost(me, 'My thread')
    const otherPost = await seedPost(alice, 'Not mine')

    // Mine: two rows for `me`.
    await seedNotification({
      recipient: me,
      actor: alice,
      post,
      kind: 'reply_to_my_post',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    })
    await seedNotification({
      recipient: me,
      actor: bob,
      post,
      kind: 'mentioned_in_post',
      createdAt: new Date('2026-05-02T00:00:00Z'),
    })
    // Not mine: a row addressed to alice — should NOT leak.
    await seedNotification({
      recipient: alice,
      actor: bob,
      post: otherPost,
      kind: 'mentioned_in_post',
    })

    const result = await listMyNotifications({
      forumUserId: me,
      username: 'mep',
    })
    expect(result.notifications).toHaveLength(2)
    expect(result.notifications[0].kind).toBe('mentioned_in_post') // newest
    expect(result.notifications[1].kind).toBe('reply_to_my_post')
    for (const row of result.notifications) {
      // Every returned row references my user id; alice's row never appears.
      expect(row.post_id).toBe(post)
    }
  })

  it('only_unread=true skips rows with read_at set', async () => {
    const me = await seedUser('mep')
    const actor = await seedUser('them')
    const post = await seedPost(me)
    await seedNotification({
      recipient: me,
      actor,
      post,
      kind: 'mentioned_in_post',
      readAt: new Date(),
    })
    await seedNotification({
      recipient: me,
      actor,
      post,
      kind: 'reply_to_my_post',
    })

    const result = await listMyNotifications({
      forumUserId: me,
      username: 'mep',
      only_unread: true,
    })
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0].kind).toBe('reply_to_my_post')
  })

  // Suppress unused-import warnings in environments where the helpers
  // aren't fully exercised.
  it('module surface stays callable across cursor paginations', async () => {
    const me = await seedUser('mep')
    const actor = await seedUser('them')
    const post = await seedPost(me)
    // Seed 3 rows; pull first page of 2, expect a next_cursor; pull
    // second page and confirm we get the third row + null cursor.
    const earliest = new Date('2026-05-01T00:00:00Z')
    await seedNotification({
      recipient: me,
      actor,
      post,
      kind: 'mentioned_in_post',
      createdAt: earliest,
    })
    await seedNotification({
      recipient: me,
      actor,
      post,
      kind: 'mentioned_in_comment',
      createdAt: new Date('2026-05-02T00:00:00Z'),
    })
    await seedNotification({
      recipient: me,
      actor,
      post,
      kind: 'reply_to_my_post',
      createdAt: new Date('2026-05-03T00:00:00Z'),
    })

    const first = await listMyNotifications({
      forumUserId: me,
      username: 'mep',
      limit: 2,
    })
    expect(first.notifications).toHaveLength(2)
    expect(first.next_cursor).not.toBeNull()

    const second = await listMyNotifications({
      forumUserId: me,
      username: 'mep',
      limit: 2,
      cursor: first.next_cursor,
    })
    expect(second.notifications).toHaveLength(1)
    expect(second.next_cursor).toBeNull()
    // SQL fragment still referenced in the test file — keep the import
    // alive so future filter checks can reuse it.
    void sql
  })
})
