/**
 * Tests for `get_user_profile`.
 *
 * Coverage:
 *   1. Unknown username → ToolError('user_not_found').
 *   2. Happy path: a user with posts, comments, post-mentions, and
 *      comment-mentions populates all four recent_* arrays.
 *
 * Harness mirrors `create-post.test.ts`.
 */

import {
  forumComments,
  forumCommentUserMentions,
  forumPosts,
  forumPostUserMentions,
  forumUsers,
} from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('getUserProfile (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let getUserProfile: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./get-user-profile.js')
    getUserProfile = mod.getUserProfile
  })

  afterAll(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: postgres-js handle
    await (db as any).$client?.end?.({ timeout: 1 })
  })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  async function seedUser(username: string, isAgent = false): Promise<string> {
    const rows = await db
      .insert(forumUsers)
      .values({ username, isAgent })
      .returning({ id: forumUsers.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  async function seedPost(authorId: string, title = 'sample'): Promise<string> {
    const rows = await db
      .insert(forumPosts)
      .values({ authorId, title, body: 'b' })
      .returning({ id: forumPosts.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  async function seedComment(postId: string, authorId: string): Promise<string> {
    const rows = await db
      .insert(forumComments)
      .values({ postId, authorId, body: 'comment body' })
      .returning({ id: forumComments.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  it('rejects with user_not_found for a missing username', async () => {
    await expect(
      getUserProfile({
        username: 'no-such-user',
        forumUserId: '00000000-0000-0000-0000-000000000000',
        callerUsername: 'me',
      }),
    ).rejects.toMatchObject({ code: 'user_not_found' })
  })

  it('populates all four recent_* arrays for a user with full activity', async () => {
    const subject = await seedUser('subject')
    const mentioner = await seedUser('mentioner')
    const replyer = await seedUser('replyer')

    // subject authored a post
    const ownPost = await seedPost(subject, 'Subject thread')

    // subject commented on mentioner's post
    const mentionersPost = await seedPost(mentioner, 'Mentioners thread')
    await seedComment(mentionersPost, subject)

    // mentioner mentioned subject in a post
    const mentionPost = await seedPost(mentioner, 'Hey @subject')
    await db.insert(forumPostUserMentions).values({
      postId: mentionPost,
      mentionedUserId: subject,
      mentionedUsername: 'subject',
    })

    // replyer mentioned subject in a comment
    const replyersPost = await seedPost(replyer, 'Random thread')
    const replyersComment = await seedComment(replyersPost, replyer)
    await db.insert(forumCommentUserMentions).values({
      commentId: replyersComment,
      mentionedUserId: subject,
      mentionedUsername: 'subject',
    })

    const result = await getUserProfile({
      username: 'subject',
      forumUserId: subject,
      callerUsername: 'subject',
    })

    expect(result.user.username).toBe('subject')
    expect(result.user.is_agent).toBe(false)
    expect(result.recent_posts.map((p: { id: string }) => p.id)).toContain(ownPost)
    expect(result.recent_comments.map((c: { post_id: string }) => c.post_id)).toContain(
      mentionersPost,
    )
    expect(result.recent_mentions_in_posts.map((m: { post_id: string }) => m.post_id)).toContain(
      mentionPost,
    )
    expect(
      result.recent_mentions_in_comments.map((m: { comment_id: string }) => m.comment_id),
    ).toContain(replyersComment)
  })
})
