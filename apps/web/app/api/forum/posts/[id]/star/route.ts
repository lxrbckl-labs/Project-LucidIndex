/**
 * POST /api/forum/posts/[id]/star
 *
 * Toggle the current viewer's star on a post. Body: `{ starred: boolean }`.
 * The client owns the desired state — if `starred` is true the server
 * inserts a row (ON CONFLICT DO NOTHING; re-starring is a no-op), if it's
 * false the server deletes any matching row.
 *
 * Stars are explicitly EXEMPT from the project's NO DELETIONS rule — see
 * `forumPostStars` in `packages/db/schema/forum.ts` for the rationale: a
 * star is ephemeral UI state, not an audit record. Toggling un-stars via
 * SQL `DELETE` is the intended path.
 *
 * Response: `{ ok: true, starred: boolean, count: number }` so the
 * client can sync its optimistic UI without a follow-up GET. `count` is
 * the global tally for the post (across all viewers), not the current
 * viewer's flag — the boolean carries that.
 *
 * Errors:
 *   - 400 invalid_input — bogus UUID, missing/non-boolean `starred`.
 *   - 401 unauthorized — no forum session.
 *   - 404 not_found    — post id doesn't resolve.
 *   - 500 db_error     — unexpected failure.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, eq, sql } from '@lucidindex/db/query'
import { forumPostStars, forumPosts } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type IncomingBody = {
  starred?: unknown
}

function badInput(error: string) {
  return NextResponse.json({ ok: false, reason: 'invalid_input', error }, { status: 400 })
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const userId = session.forumUserId

  const { id: postId } = await context.params
  if (!UUID_RE.test(postId)) {
    return badInput('Invalid post id.')
  }

  let payload: IncomingBody
  try {
    payload = (await req.json()) as IncomingBody
  } catch {
    return badInput('Request body is not valid JSON.')
  }

  if (typeof payload.starred !== 'boolean') {
    return badInput('`starred` must be a boolean.')
  }

  // Confirm the post exists before insert/delete — surfaces a specific
  // 404 instead of letting the FK insert raise an opaque error.
  const postRows = await db
    .select({ id: forumPosts.id })
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1)
  if (postRows.length === 0) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  try {
    if (payload.starred) {
      // INSERT … ON CONFLICT DO NOTHING — re-star by the same viewer is
      // a no-op. The composite PK on (post_id, user_id) is the conflict
      // target.
      await db
        .insert(forumPostStars)
        .values({ postId, userId })
        .onConflictDoNothing({
          target: [forumPostStars.postId, forumPostStars.userId],
        })
    } else {
      await db
        .delete(forumPostStars)
        .where(and(eq(forumPostStars.postId, postId), eq(forumPostStars.userId, userId)))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return NextResponse.json({ ok: false, reason: 'db_error', error: message }, { status: 500 })
  }

  // Re-read the global count + the current viewer's flag so the client
  // can sync state with one round-trip. Both queries hit the same
  // composite-PK index.
  const [countRows, mineRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPostStars)
      .where(eq(forumPostStars.postId, postId)),
    db
      .select({ p: forumPostStars.postId })
      .from(forumPostStars)
      .where(and(eq(forumPostStars.postId, postId), eq(forumPostStars.userId, userId)))
      .limit(1),
  ])

  return NextResponse.json({
    ok: true,
    starred: mineRows.length > 0,
    count: countRows[0]?.count ?? 0,
  })
}
