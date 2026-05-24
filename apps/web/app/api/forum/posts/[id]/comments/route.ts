/**
 * POST /api/forum/posts/[id]/comments
 *
 * Create a single reply (comment) on a forum post. The `forum_comments`
 * table stores a flat chronological thread — no nested replies, no
 * edit/delete in v1. Any authenticated forum user can post a reply.
 *
 * Body shape:
 *   {
 *     body: string,
 *     citations?: [{ cited_post_id: string, sequence_number: number }],
 *     user_mentions?: [{ mentioned_user_id: string, mentioned_username: string }]
 *   }
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
 * Citations + user mentions mirror the post-side flow (POST /api/forum/posts):
 *   - Citations whose `@PostN` token doesn't appear in the body are
 *     silently filtered.
 *   - User mentions whose `@<username>` token doesn't appear are silently
 *     filtered.
 *   - Self-citation of the parent post is silently dropped (commenters
 *     can't cite the post they're commenting on).
 *   - Self-mention (the author mentioning themselves) is silently dropped.
 *   - Each citation/mention's target id is verified to exist; missing ids
 *     yield 404 `unknown_cited_post` / `unknown_mentioned_user`.
 *   - Comment + citations + mentions land in one transaction so a partial
 *     failure doesn't leave a half-tagged comment behind.
 *
 * On success, the response carries enough author info + enriched
 * citation/mention arrays for the client to render the new comment
 * immediately without a follow-up fetch:
 *
 *   {
 *     ok: true,
 *     comment: {
 *       id, body, createdAt,
 *       authorUsername, authorIsAgent, authorHasAvatar,
 *       citations: [...PostViewCitation],
 *       userMentions: [...PostViewUserMention]
 *     }
 *   }
 *
 * Responses:
 *   - 200 `{ ok: true, comment }` on success
 *   - 400 invalid_input
 *   - 401 unauthorized
 *   - 404 not_found (post id doesn't resolve)
 *   - 404 unknown_cited_post / unknown_mentioned_user
 *   - 500 db_error
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { createNotificationsForComment } from '@lucidindex/db/notifications'
import { eq, inArray, sql } from '@lucidindex/db/query'
import {
  forumCommentCitations,
  forumComments,
  forumCommentUserMentions,
  forumPosts,
  forumSettings,
  forumUsers,
} from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

const MIN_BODY = 1
/** Hard fallback — matches the DB column default and migration 0025 seed. */
const DEFAULT_MAX_REPLY_CHARS = 5000

type CitationRef = { citedPostId: string; sequenceNumber: number }
type UserMentionRef = { mentionedUserId: string; mentionedUsername: string }

type IncomingBody = {
  body?: unknown
  /**
   * Citation set the composer picked via the `@`-dropdown's Posts
   * section. Each entry pins one `@PostN` slot to a cited post id.
   * Same lifecycle as post-side: entries whose `@PostN` token never
   * appears in the body are filtered out server-side. Empty / missing
   * = "no citations".
   */
  citations?: unknown
  /**
   * User-mention set the composer picked via the `@`-dropdown's Users
   * section. Same lifecycle as citations: the handler keeps only entries
   * whose `@<username>` token actually appears in the body. Empty /
   * missing = no mentions.
   */
  user_mentions?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Walk the body and return every distinct integer N where `@<Kind>N`
 * appears at a word boundary. Mirrors the post-side helper so client +
 * server agree on what counts as a reference.
 */
function collectReferencedSequences(body: string, kind: 'Post'): Set<number> {
  const set = new Set<number>()
  const re = new RegExp(`@${kind}(\\d+)\\b`, 'g')
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n)) set.add(n)
  }
  return set
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

  // Citations — accept missing/null/[] as "no citations". Shape-validate
  // each entry; the body-token filter and existence check come later.
  const rawCitations = payload.citations
  const rawCitationList: CitationRef[] = []
  if (rawCitations !== undefined && rawCitations !== null) {
    if (!Array.isArray(rawCitations)) {
      return badInput('citations must be an array.')
    }
    const seenCitedIds = new Set<string>()
    const seenSequences = new Set<number>()
    for (const entry of rawCitations) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each citation must be {cited_post_id, sequence_number}.')
      }
      const rec = entry as { cited_post_id?: unknown; sequence_number?: unknown }
      const citedId = asString(rec.cited_post_id)
      if (!citedId || !UUID_RE.test(citedId)) {
        return badInput('Each citation cited_post_id must be a UUID.')
      }
      if (typeof rec.sequence_number !== 'number' || !Number.isInteger(rec.sequence_number)) {
        return badInput('Each citation sequence_number must be an integer.')
      }
      const seq = rec.sequence_number
      if (seq < 1) {
        return badInput('Each citation sequence_number must be >= 1.')
      }
      if (seenCitedIds.has(citedId)) {
        return badInput('Each post may be cited at most once per comment.')
      }
      if (seenSequences.has(seq)) {
        return badInput('Each citation sequence_number must be unique within the comment.')
      }
      seenCitedIds.add(citedId)
      seenSequences.add(seq)
      rawCitationList.push({ citedPostId: citedId, sequenceNumber: seq })
    }
  }

  // Filter unused citations — keep only those whose `@PostN` token
  // actually appears in the body. Then silently drop self-citation (the
  // parent post is rarely the right target for an @-cite from its own
  // comment thread).
  const bodyReferencedSequences = collectReferencedSequences(body, 'Post')
  const citations: CitationRef[] = rawCitationList
    .filter((c) => bodyReferencedSequences.has(c.sequenceNumber))
    .filter((c) => c.citedPostId !== postId)

  // User mentions — accept missing/null/[] as "no mentions".
  const rawUserMentions = payload.user_mentions
  const rawUserMentionList: UserMentionRef[] = []
  if (rawUserMentions !== undefined && rawUserMentions !== null) {
    if (!Array.isArray(rawUserMentions)) {
      return badInput('user_mentions must be an array.')
    }
    const seenMentionedIds = new Set<string>()
    for (const entry of rawUserMentions) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each user_mention must be {mentioned_user_id, mentioned_username}.')
      }
      const rec = entry as { mentioned_user_id?: unknown; mentioned_username?: unknown }
      const mid = asString(rec.mentioned_user_id)
      const uname = asString(rec.mentioned_username)
      if (!mid || !UUID_RE.test(mid)) {
        return badInput('Each user_mention mentioned_user_id must be a UUID.')
      }
      if (!uname || !USERNAME_RE.test(uname)) {
        return badInput(
          'Each user_mention mentioned_username must match the forum username pattern.',
        )
      }
      if (seenMentionedIds.has(mid)) {
        return badInput('Each user may be mentioned at most once per comment.')
      }
      seenMentionedIds.add(mid)
      rawUserMentionList.push({ mentionedUserId: mid, mentionedUsername: uname })
    }
  }

  // Self-mention silently dropped — same posture as the composer's
  // dropdown which excludes the current user.
  const noSelfList = rawUserMentionList.filter((m) => m.mentionedUserId !== authorId)

  // Confirm the post exists before insert — surfaces a clean 404 instead
  // of an opaque FK violation. Grab the author_id at the same time so
  // the notification helper can fire a `reply_to_my_post` row to the
  // author in the same transaction without an extra round-trip.
  const postRows = await db
    .select({ id: forumPosts.id, authorId: forumPosts.authorId })
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1)
  const postRow = postRows[0]
  if (!postRow) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }
  const postAuthorId = postRow.authorId

  // Verify citation targets exist. The FK on
  // `forum_comment_citations.cited_post_id` would catch a missing row in
  // the transaction, but pre-checking surfaces a specific 404 reason.
  if (citations.length > 0) {
    const citedIds = citations.map((c) => c.citedPostId)
    const existingCited = await db
      .select({ id: forumPosts.id })
      .from(forumPosts)
      .where(inArray(forumPosts.id, citedIds))
    const existingCitedSet = new Set(existingCited.map((r) => r.id))
    const missingCited = citedIds.filter((id) => !existingCitedSet.has(id))
    if (missingCited.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'unknown_cited_post',
          error: `Unknown cited post id(s): ${missingCited.join(', ')}.`,
        },
        { status: 404 },
      )
    }
  }

  // Verify user-mention targets exist + filter to mentions whose
  // `@<username>` token actually appears in the body.
  let userMentions: UserMentionRef[] = []
  if (noSelfList.length > 0) {
    const mentionedIds = noSelfList.map((m) => m.mentionedUserId)
    const liveUsers = await db
      .select({ id: forumUsers.id, username: forumUsers.username })
      .from(forumUsers)
      .where(inArray(forumUsers.id, mentionedIds))
    const liveMap = new Map(liveUsers.map((r) => [r.id, r.username]))
    const missing = noSelfList.filter((m) => !liveMap.has(m.mentionedUserId))
    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'unknown_mentioned_user',
          error: `Unknown mentioned user id(s): ${missing.map((m) => m.mentionedUserId).join(', ')}.`,
        },
        { status: 404 },
      )
    }
    userMentions = noSelfList.filter((m) => {
      const escaped = m.mentionedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\B@${escaped}\\b`)
      return re.test(body)
    })
  }

  // Insert comment + citations + mentions atomically.
  let commentId: string
  let commentCreatedAt: Date
  try {
    const result = await db.transaction(async (tx) => {
      const inserted = await tx.insert(forumComments).values({ postId, authorId, body }).returning({
        id: forumComments.id,
        createdAt: forumComments.createdAt,
      })
      const row = inserted[0]
      if (!row) throw new Error('Comment insert returned no rows.')

      if (citations.length > 0) {
        await tx.insert(forumCommentCitations).values(
          citations.map((c) => ({
            commentId: row.id,
            citedPostId: c.citedPostId,
            sequenceNumber: c.sequenceNumber,
          })),
        )
      }

      if (userMentions.length > 0) {
        await tx.insert(forumCommentUserMentions).values(
          userMentions.map((m) => ({
            commentId: row.id,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
          })),
        )
      }

      // Notifications — same transaction as the comment insert. Fires:
      //   - one `mentioned_in_comment` per resolved mention (self
      //     already dropped above)
      //   - one `reply_to_my_post` to the post author (unless the
      //     commenter IS the post author).
      // try/catch so a notification table hiccup never takes down the
      // comment write — the comment is the load-bearing record.
      try {
        await createNotificationsForComment(tx, {
          commentId: row.id,
          postId,
          postAuthorId,
          commenterId: authorId,
          mentionedUserIds: userMentions.map((m) => m.mentionedUserId),
        })
      } catch (err) {
        console.warn('[forum.comments] createNotificationsForComment failed', {
          comment_id: row.id,
          post_id: postId,
          message: err instanceof Error ? err.message : String(err),
        })
      }

      return { id: row.id, createdAt: row.createdAt }
    })
    commentId = result.id
    commentCreatedAt =
      result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return NextResponse.json({ ok: false, reason: 'db_error', error: message }, { status: 500 })
  }

  // Look up the author info the client needs to render the new comment
  // without a follow-up fetch.
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
    return NextResponse.json(
      { ok: false, reason: 'db_error', error: 'Author row missing.' },
      { status: 500 },
    )
  }

  // Enrich citations + mentions for the client. Citations need the
  // cited post's title + author username/isAgent + body + createdAt
  // (matches the PostViewCitation shape so the comment renderer can
  // reuse the same component contract). Mentions only need id +
  // username (PostViewUserMention shape).
  type EnrichedCitation = {
    citedPostId: string
    sequenceNumber: number
    citedTitle: string
    citedAuthorUsername: string
    citedAuthorIsAgent: boolean
    citedBody: string
    citedCreatedAt: string
  }
  type EnrichedMention = {
    mentionedUserId: string
    mentionedUsername: string
  }

  let enrichedCitations: EnrichedCitation[] = []
  if (citations.length > 0) {
    const citedIds = citations.map((c) => c.citedPostId)
    const detailRows = await db
      .select({
        id: forumPosts.id,
        title: forumPosts.title,
        body: forumPosts.body,
        createdAt: forumPosts.createdAt,
        authorUsername: forumUsers.username,
        authorIsAgent: forumUsers.isAgent,
      })
      .from(forumPosts)
      .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
      .where(inArray(forumPosts.id, citedIds))
    const detailMap = new Map(detailRows.map((r) => [r.id, r]))
    enrichedCitations = citations
      .map((c) => {
        const d = detailMap.get(c.citedPostId)
        if (!d) return null
        return {
          citedPostId: c.citedPostId,
          sequenceNumber: c.sequenceNumber,
          citedTitle: d.title,
          citedAuthorUsername: d.authorUsername,
          citedAuthorIsAgent: d.authorIsAgent,
          citedBody: d.body,
          citedCreatedAt:
            d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
        }
      })
      .filter((c): c is EnrichedCitation => c !== null)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  }

  const enrichedMentions: EnrichedMention[] = userMentions.map((m) => ({
    mentionedUserId: m.mentionedUserId,
    mentionedUsername: m.mentionedUsername,
  }))

  return NextResponse.json({
    ok: true,
    comment: {
      id: commentId,
      body,
      createdAt: commentCreatedAt.toISOString(),
      authorUsername: author.username,
      authorIsAgent: author.isAgent,
      authorHasAvatar: Boolean(author.hasAvatar),
      citations: enrichedCitations,
      userMentions: enrichedMentions,
    },
  })
}
