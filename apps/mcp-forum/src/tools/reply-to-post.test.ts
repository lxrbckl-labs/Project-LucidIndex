/**
 * Tests for `reply_to_post` — the agent-side comment composer.
 *
 * Coverage:
 *   1. Happy path — comment lands, returns comment_id + post_id + counts.
 *   2. Unknown mentioned_username → ToolError('unknown_mentioned_user').
 *   3. Unknown cited_post_id → ToolError('unknown_cited_post').
 *   4. `dropped_self_mention: true` when caller is in user_mentions.
 *   5. `dropped_self_citation: true` when caller cites the parent post.
 *
 * Test harness mirrors create-post.test.ts — same `makeTestDb()` +
 * `truncateAllTables()` setup.
 */

import {
  forumComments,
  forumCommentUserMentions,
  forumPosts,
  forumUsers,
} from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('replyToPost (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let replyToPost: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./reply-to-post.js')
    replyToPost = mod.replyToPost
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

  it('happy path: inserts a comment and returns comment_id + counts', async () => {
    const author = await seedUser('alice')
    const postId = await seedPost(author)

    const result = await replyToPost({
      post_id: postId,
      body: 'Great post.',
      forumUserId: author,
      username: 'alice',
    })

    expect(result.comment_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.post_id).toBe(postId)
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.user_mention_count).toBe(0)
    expect(result.citation_count).toBe(0)

    const rows = await db
      .select({ id: forumComments.id, body: forumComments.body })
      .from(forumComments)
      .where(eq(forumComments.id, result.comment_id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.body).toBe('Great post.')
  })

  it('persists user_mentions, drops self-mention, and surfaces dropped_self_mention', async () => {
    const author = await seedUser('alice')
    await seedUser('bob')
    const postId = await seedPost(author)

    const result = await replyToPost({
      post_id: postId,
      body: 'Hi @bob — also pinging myself @alice (should be dropped).',
      user_mentions: [
        { mentioned_username: 'bob' },
        { mentioned_username: 'alice' }, // self — should be silently dropped
      ],
      forumUserId: author,
      username: 'alice',
    })

    // alice (self) is silently dropped, only bob persists. The
    // `dropped_self_mention` flag tells the agent the drop fired.
    expect(result.user_mention_count).toBe(1)
    expect(result.dropped_self_mention).toBe(true)
    expect(result.dropped_self_citation).toBe(false)
    const mentions = await db
      .select({ username: forumCommentUserMentions.mentionedUsername })
      .from(forumCommentUserMentions)
      .where(eq(forumCommentUserMentions.commentId, result.comment_id))
    expect(mentions.map((m) => m.username)).toEqual(['bob'])
  })

  it('flags dropped_self_citation when the caller cites the parent post', async () => {
    const author = await seedUser('alice')
    const postId = await seedPost(author)

    const result = await replyToPost({
      post_id: postId,
      body: 'See above @Post1 (self-cite of parent should be dropped).',
      citations: [{ cited_post_id: postId }],
      forumUserId: author,
      username: 'alice',
    })

    // The only citation was the parent — drop fires; persisted count
    // is zero; the flag tells the agent why.
    expect(result.citation_count).toBe(0)
    expect(result.dropped_self_citation).toBe(true)
    expect(result.dropped_self_mention).toBe(false)
  })

  it('throws unknown_mentioned_user when a mentioned_username is missing', async () => {
    const author = await seedUser('alice')
    const postId = await seedPost(author)

    await expect(
      replyToPost({
        post_id: postId,
        body: '@nobody around?',
        user_mentions: [{ mentioned_username: 'nobody' }],
        forumUserId: author,
        username: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'unknown_mentioned_user' })

    const comments = await db.select({ id: forumComments.id }).from(forumComments)
    expect(comments).toHaveLength(0)
  })

  it('throws unknown_cited_post when a cited_post_id does not exist', async () => {
    const author = await seedUser('alice')
    const postId = await seedPost(author)
    const ghostPostId = '00000000-0000-0000-0000-000000000000'

    await expect(
      replyToPost({
        post_id: postId,
        body: 'See @Post1.',
        citations: [{ cited_post_id: ghostPostId }],
        forumUserId: author,
        username: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'unknown_cited_post' })

    const comments = await db.select({ id: forumComments.id }).from(forumComments)
    expect(comments).toHaveLength(0)
  })
})
