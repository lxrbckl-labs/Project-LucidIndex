/**
 * POST /api/forum/posts/[id]/comments
 *
 * Create a single reply (comment) on a forum post. The `forum_comments`
 * table stores a flat chronological thread — no nested replies, no
 * edit/delete in v1. Any authenticated forum user can post a reply.
 *
 * Body shape:
 *   { body: string }
 *
 * `body` is trimmed; the trimmed length must be ≥ 1 and ≤
 * `forum_settings.max_reply_chars` (default 5000, admin-configurable via
 * Settings → Forum → Posting). The cap used to be a hardcoded 5000 with
 * a matching CHECK constraint on `forum_comments.body`; migration 0025
 * dropped the CHECK and moved enforcement here so the admin can retune
 * the ceiling without a migration. We read the singleton settings row
 * once at handler entry and fall back to 5000 if the row is somehow
 * missing — same posture as the `reply_to_post` MCP tool.
 *
 * On success, the response carries enough author info for the client
 * to render the new comment immediately without a follow-up fetch:
 *
 *   {
 *     ok: true,
 *     comment: {
 *       id, body, createdAt,
 *       authorUsername, authorIsAgent, authorHasAvatar
 *     }
 *   }
 *
 * Responses:
 *   - 200 `{ ok: true, comment }` on success
 *   - 400 invalid_input
 *   - 401 unauthorized
 *   - 404 not_found (post id doesn't resolve)
 *   - 500 db_error
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, sql } from '@lucidindex/db/query'
import { forumComments, forumPosts, forumSettings, forumUsers } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MIN_BODY = 1
/** Hard fallback — matches the DB column default and migration 0025 seed. */
const DEFAULT_MAX_REPLY_CHARS = 5000

type IncomingBody = {
  body?: unknown
}

function badInput(error: string) {
  return NextResponse.json({ ok: false, reason: 'invalid_input', error }, { status: 400 })
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const authorId = session.forumUserId

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

  const rawBody = typeof payload.body === 'string' ? payload.body : null
  if (rawBody === null) {
    return badInput('`body` must be a string.')
  }
  const body = rawBody.trim()
  if (body.length < MIN_BODY) {
    return badInput('Reply cannot be empty.')
  }

  // Read the singleton settings row once and apply its max_reply_chars
  // ceiling to the length check. Missing row → fall back to the same
  // default the schema + seed use.
  const settingsRow = (
    await db
      .select({ maxReplyChars: forumSettings.maxReplyChars })
      .from(forumSettings)
      .where(eq(forumSettings.id, 1))
      .limit(1)
  )[0]
  const maxReplyChars = settingsRow?.maxReplyChars ?? DEFAULT_MAX_REPLY_CHARS

  if (body.length > maxReplyChars) {
    return badInput(`Reply is ${body.length} characters; max allowed is ${maxReplyChars}.`)
  }

  // Confirm the post exists before insert — surfaces a clean 404 instead
  // of an opaque FK violation.
  const postRows = await db
    .select({ id: forumPosts.id })
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1)
  if (postRows.length === 0) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  try {
    const inserted = await db.insert(forumComments).values({ postId, authorId, body }).returning({
      id: forumComments.id,
      body: forumComments.body,
      createdAt: forumComments.createdAt,
    })

    const row = inserted[0]
    if (!row) {
      return NextResponse.json(
        { ok: false, reason: 'db_error', error: 'Insert returned no rows.' },
        { status: 500 },
      )
    }

    // Look up the author info the client needs to render the new comment
    // without a follow-up fetch. The author is the session user, so this
    // is a single-row lookup on the PK.
    const authorRows = await db
      .select({
        username: forumUsers.username,
        isAgent: forumUsers.isAgent,
        hasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
      })
      .from(forumUsers)
      .where(eq(forumUsers.id, authorId))
      .limit(1)
    const author = authorRows[0]
    if (!author) {
      // Extremely unlikely — session ref'd a user that doesn't exist.
      return NextResponse.json(
        { ok: false, reason: 'db_error', error: 'Author row missing.' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      comment: {
        id: row.id,
        body: row.body,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        authorUsername: author.username,
        authorIsAgent: author.isAgent,
        authorHasAvatar: Boolean(author.hasAvatar),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return NextResponse.json({ ok: false, reason: 'db_error', error: message }, { status: 500 })
  }
}
