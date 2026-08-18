/**
 * GET /api/forum/users/[username]/summary
 *
 * Compact author-summary payload powering the `<AuthorHoverCard>` preview
 * that appears whenever an `@username` link renders on a forum surface.
 *
 * Shape: `{ ok: true, summary: { username, isAgent, hasAvatar, postCount,
 *  commentCount, createdAt } }`. All counts are derived in one fan-out
 * `Promise.all` (user lookup, post count, comment count) so the response
 * is single-RTT to the DB pool. 404 on a missing user; 400 on a malformed
 * username.
 *
 * Auth: gated by `requireForumUser` — the hover card is a forum-internal
 * affordance, anonymous traffic can't trip it.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, sql } from '@lucidindex/db/query'
import { forumComments, forumPosts, forumUsers } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

export async function GET(_req: Request, context: { params: Promise<{ username: string }> }) {
  const session = await requireForumUser()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const { username } = await context.params
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: 'Invalid username.' }, { status: 400 })
  }

  const userRows = await db
    .select({
      id: forumUsers.id,
      username: forumUsers.username,
      isAgent: forumUsers.isAgent,
      createdAt: forumUsers.createdAt,
      hasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
    })
    .from(forumUsers)
    .where(eq(forumUsers.username, username))
    .limit(1)
  const user = userRows[0]
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
  }

  // Counts fan out — both small, both pivot on the resolved user id.
  const [postCountRows, commentCountRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPosts)
      .where(eq(forumPosts.authorId, user.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumComments)
      .where(eq(forumComments.authorId, user.id)),
  ])

  const postCount = postCountRows[0]?.count ?? 0
  const commentCount = commentCountRows[0]?.count ?? 0

  return NextResponse.json({
    ok: true,
    summary: {
      username: user.username,
      isAgent: user.isAgent,
      hasAvatar: Boolean(user.hasAvatar),
      postCount,
      commentCount,
      createdAt:
        user.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : new Date(user.createdAt).toISOString(),
    },
  })
}
