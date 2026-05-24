/**
 * Tests for `create_post` — the agent-side post composer.
 *
 * Coverage:
 *   1. Happy path — post lands, returns post_id + created_at + counts.
 *   2. Unknown mentioned_username → ToolError('unknown_mentioned_user').
 *   3. Unknown cited_post_id → ToolError('unknown_cited_post').
 *   4. `dropped_self_mention: true` when caller is in user_mentions.
 *   5. Lowercase username normalization — `"ALICE"` resolves to `alice`.
 *   6. `dropped_self_citation: false` always — no parent post to self-cite.
 *
 * Test harness: same shape as
 * `apps/mcp-dashboard/src/tools/check-article-exists.test.ts` — uses
 * `@lucidindex/db/test-helpers`'s `makeTestDb()` +
 * `truncateAllTables()` + `resolveTestDatabaseUrl()`. Requires
 * `DATABASE_URL_TEST` (or a `lucidindex_test` DB at the same host as
 * `DATABASE_URL`) to be reachable.
 *
 * The tool under test (`createPost`) uses the module-level `db`
 * proxy from `@lucidindex/db/client`, which resolves `DATABASE_URL`
 * lazily — so we set `process.env.DATABASE_URL` to the test DB URL
 * in a `beforeAll` BEFORE the dynamic import.
 */

import { forumPosts, forumPostUserMentions, forumUsers } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('createPost (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let createPost: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./create-post.js')
    createPost = mod.createPost
  })

  afterAll(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: postgres-js handle
    await (db as any).$client?.end?.({ timeout: 1 })
  })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  /** Insert a forum user and return its id + username. */
  async function seedUser(username: string, isAgent = true): Promise<string> {
    const rows = await db
      .insert(forumUsers)
      .values({ username, isAgent })
      .returning({ id: forumUsers.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  it('happy path: inserts a post and returns post_id + created_at + counts', async () => {
    const authorId = await seedUser('agent-author')
    const result = await createPost({
      title: 'First post',
      body: 'Body of the first post.',
      forumUserId: authorId,
      username: 'agent-author',
    })

    expect(result.post_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.user_mention_count).toBe(0)
    expect(result.citation_count).toBe(0)

    // Verify the row actually landed.
    const rows = await db
      .select({ id: forumPosts.id, title: forumPosts.title })
      .from(forumPosts)
      .where(eq(forumPosts.id, result.post_id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('First post')
  })

  it('persists user_mentions when every mentioned_username exists', async () => {
    const authorId = await seedUser('alice')
    await seedUser('bob')
    await seedUser('carol')

    const result = await createPost({
      title: 'Hello',
      body: 'Hi @bob and @carol — please review.',
      user_mentions: [{ mentioned_username: 'bob' }, { mentioned_username: 'carol' }],
      forumUserId: authorId,
      username: 'alice',
    })

    expect(result.user_mention_count).toBe(2)

    const mentionRows = await db
      .select({
        username: forumPostUserMentions.mentionedUsername,
      })
      .from(forumPostUserMentions)
      .where(eq(forumPostUserMentions.postId, result.post_id))
    const usernames = mentionRows.map((r) => r.username).sort()
    expect(usernames).toEqual(['bob', 'carol'])
  })

  it('throws unknown_mentioned_user when a mentioned_username is not in forum_users', async () => {
    const authorId = await seedUser('alice')
    await seedUser('bob')

    await expect(
      createPost({
        title: 'Hello',
        body: 'Hi @bob and @nobody.',
        user_mentions: [{ mentioned_username: 'bob' }, { mentioned_username: 'nobody' }],
        forumUserId: authorId,
        username: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'unknown_mentioned_user' })

    // The post should NOT have been inserted (validation runs before the txn).
    const allPosts = await db.select({ id: forumPosts.id }).from(forumPosts)
    expect(allPosts).toHaveLength(0)
  })

  it('throws unknown_cited_post when a cited_post_id does not exist', async () => {
    const authorId = await seedUser('alice')
    const ghostPostId = '00000000-0000-0000-0000-000000000000'

    await expect(
      createPost({
        title: 'Reference',
        body: 'See @Post1 below.',
        citations: [{ cited_post_id: ghostPostId }],
        forumUserId: authorId,
        username: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'unknown_cited_post' })

    const allPosts = await db.select({ id: forumPosts.id }).from(forumPosts)
    expect(allPosts).toHaveLength(0)
  })

  it('flags dropped_self_mention when the caller mentions themselves; counts exclude the dropped row', async () => {
    const authorId = await seedUser('alice')
    await seedUser('bob')

    const result = await createPost({
      title: 'Self-aware',
      body: 'Hi @bob — also self-pinging @alice (should be dropped).',
      user_mentions: [
        { mentioned_username: 'bob' },
        { mentioned_username: 'alice' }, // self — silently dropped
      ],
      forumUserId: authorId,
      username: 'alice',
    })

    expect(result.user_mention_count).toBe(1)
    expect(result.dropped_self_mention).toBe(true)
    // create_post has no parent post — self-citation is structurally
    // impossible here, so the flag is always false.
    expect(result.dropped_self_citation).toBe(false)

    const mentions = await db
      .select({ username: forumPostUserMentions.mentionedUsername })
      .from(forumPostUserMentions)
      .where(eq(forumPostUserMentions.postId, result.post_id))
    expect(mentions.map((m) => m.username)).toEqual(['bob'])
  })

  it('lowercases mentioned usernames server-side — `"ALICE"` resolves to `alice`', async () => {
    const authorId = await seedUser('agent-author')
    await seedUser('alice')

    const result = await createPost({
      title: 'Case test',
      body: 'Hi @alice.',
      // Author passes the mixed-case form — server should lowercase
      // before the validation SELECT and the eventual INSERT.
      user_mentions: [{ mentioned_username: 'ALICE' }],
      forumUserId: authorId,
      username: 'agent-author',
    })

    expect(result.user_mention_count).toBe(1)
    // The persisted snapshot is the lowercase canonical handle, NOT
    // the agent's mixed-case input.
    const mentions = await db
      .select({ username: forumPostUserMentions.mentionedUsername })
      .from(forumPostUserMentions)
      .where(eq(forumPostUserMentions.postId, result.post_id))
    expect(mentions.map((m) => m.username)).toEqual(['alice'])
  })
})
