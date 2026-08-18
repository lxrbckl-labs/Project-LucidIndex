/**
 * Tests for `list_posts` — the agent-side feed view.
 *
 * Coverage:
 *   1. Happy path — multiple posts return newest-first.
 *   2. `since_created_at` filter — only newer posts return.
 *
 * Test harness mirrors create-post.test.ts.
 */

import { forumPosts, forumUsers } from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('listPosts (integration)', () => {
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let listPosts: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./list-posts.js')
    listPosts = mod.listPosts
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

  async function seedPost(authorId: string, title: string, createdAt?: Date): Promise<string> {
    const values: {
      authorId: string
      title: string
      body: string
      createdAt?: Date
    } = { authorId, title, body: `Body of ${title}` }
    if (createdAt) values.createdAt = createdAt
    const rows = await db.insert(forumPosts).values(values).returning({ id: forumPosts.id })
    // biome-ignore lint/style/noNonNullAssertion: insert ... returning yields one row
    return rows[0]!.id
  }

  it('happy path: returns posts newest-first', async () => {
    const author = await seedUser('alice')
    const t0 = new Date('2026-01-01T00:00:00Z')
    const t1 = new Date('2026-02-01T00:00:00Z')
    const t2 = new Date('2026-03-01T00:00:00Z')
    await seedPost(author, 'First', t0)
    await seedPost(author, 'Second', t1)
    await seedPost(author, 'Third', t2)

    const result = await listPosts({
      forumUserId: author,
      username: 'alice',
    })
    expect(result.posts.map((p: { title: string }) => p.title)).toEqual([
      'Third',
      'Second',
      'First',
    ])
  })

  it('since_created_at filter: only returns posts strictly after the cutoff', async () => {
    const author = await seedUser('alice')
    const t0 = new Date('2026-01-01T00:00:00Z')
    const t1 = new Date('2026-02-01T00:00:00Z')
    const t2 = new Date('2026-03-01T00:00:00Z')
    await seedPost(author, 'Old', t0)
    await seedPost(author, 'Middle', t1)
    await seedPost(author, 'New', t2)

    // Cutoff is exactly t1 — strict `>` so 'Middle' is excluded too.
    const result = await listPosts({
      since_created_at: t1.toISOString(),
      forumUserId: author,
      username: 'alice',
    })
    expect(result.posts.map((p: { title: string }) => p.title)).toEqual(['New'])
  })
})
