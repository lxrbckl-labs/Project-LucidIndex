/**
 * GET / PATCH / DELETE /api/forum/drafts/:id
 *
 * Per-draft endpoint. All three verbs require a forum session and verify
 * ownership before touching the row — the repo's `userId` parameter is
 * the actual enforcement; the route just forwards the session user.
 *
 * GET returns the full draft + images so the composer can hydrate state
 * when `/forum/create?draft=<id>` is opened.
 *
 * PATCH replaces every field, including the draft_images set (DELETE
 * then INSERT in one transaction). Body shape matches the create
 * endpoint at `/api/forum/drafts`.
 *
 * DELETE removes the row; cascade handles draft_images. Idempotent:
 * deleting an already-gone draft returns `ok: true, deleted: false`.
 *
 * Responses:
 *   - 200 on success
 *   - 400 invalid_input
 *   - 401 unauthorized
 *   - 404 not_found (PATCH only — GET collapses missing/wrong-owner to 404, DELETE is idempotent)
 */

import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  type DraftCitation,
  type DraftImage,
  type DraftUserMention,
  deleteDraft,
  getDraftForUser,
  updateDraft,
} from '@/app/forum/create/_lib/drafts-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type IncomingBody = {
  title?: unknown
  body?: unknown
  topic_badge_ids?: unknown
  images?: unknown
  citations?: unknown
  user_mentions?: unknown
  /**
   * Optional sha256 hex of the starred cover image. Same posture as the
   * sibling POST endpoint — null / missing means "no cover".
   */
  cover_image_hash?: unknown
}

function badInput(error: string) {
  return NextResponse.json({ ok: false, reason: 'invalid_input', error }, { status: 400 })
}

function unauthorized() {
  return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
}

function notFound() {
  return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) return unauthorized()
  const { id } = await context.params
  if (!UUID_RE.test(id)) return badInput('Invalid draft id.')

  const result = await getDraftForUser(id, session.forumUserId)
  if (!result) return notFound()

  return NextResponse.json({
    ok: true,
    draft: {
      id: result.draft.id,
      title: result.draft.title,
      body: result.draft.body,
      topic_badge_ids: result.draft.topicBadgeIds,
      cover_image_hash: result.draft.coverImageHash,
      created_at: result.draft.createdAt.toISOString(),
      updated_at: result.draft.updatedAt.toISOString(),
    },
    images: result.images,
    citations: result.citations.map((c) => ({
      cited_post_id: c.citedPostId,
      sequence_number: c.sequenceNumber,
      post_title: c.postTitle,
      author_username: c.authorUsername,
    })),
    user_mentions: result.userMentions.map((m) => ({
      mentioned_user_id: m.mentionedUserId,
      mentioned_username: m.mentionedUsername,
      is_agent: m.isAgent,
    })),
  })
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) return unauthorized()
  const { id } = await context.params
  if (!UUID_RE.test(id)) return badInput('Invalid draft id.')

  let payload: IncomingBody
  try {
    payload = (await req.json()) as IncomingBody
  } catch {
    return badInput('Request body is not valid JSON.')
  }

  const title = typeof payload.title === 'string' ? payload.title : ''
  const body = typeof payload.body === 'string' ? payload.body : ''

  const rawTopicIds = payload.topic_badge_ids
  let topicBadgeIds: string[] = []
  if (rawTopicIds !== undefined && rawTopicIds !== null) {
    if (!Array.isArray(rawTopicIds)) return badInput('topic_badge_ids must be an array.')
    for (const t of rawTopicIds) {
      if (typeof t !== 'string') return badInput('Each topic id must be a string.')
      topicBadgeIds.push(t)
    }
    topicBadgeIds = Array.from(new Set(topicBadgeIds))
  }

  const rawImages = payload.images
  const images: DraftImage[] = []
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages)) return badInput('images must be an array.')
    for (const entry of rawImages) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each image must be an object with hash + mime.')
      }
      const rec = entry as { hash?: unknown; mime?: unknown }
      if (typeof rec.hash !== 'string' || typeof rec.mime !== 'string') {
        return badInput('Each image must carry a string hash + mime.')
      }
      images.push({ hash: rec.hash, mime: rec.mime })
    }
  }

  const rawCitations = payload.citations
  const citations: DraftCitation[] = []
  if (rawCitations !== undefined && rawCitations !== null) {
    if (!Array.isArray(rawCitations)) return badInput('citations must be an array.')
    for (const entry of rawCitations) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each citation must be {cited_post_id, sequence_number}.')
      }
      const rec = entry as { cited_post_id?: unknown; sequence_number?: unknown }
      if (typeof rec.cited_post_id !== 'string') {
        return badInput('Each citation cited_post_id must be a string.')
      }
      if (typeof rec.sequence_number !== 'number' || !Number.isInteger(rec.sequence_number)) {
        return badInput('Each citation sequence_number must be an integer.')
      }
      citations.push({ citedPostId: rec.cited_post_id, sequenceNumber: rec.sequence_number })
    }
  }

  const rawUserMentions = payload.user_mentions
  const userMentions: DraftUserMention[] = []
  if (rawUserMentions !== undefined && rawUserMentions !== null) {
    if (!Array.isArray(rawUserMentions)) return badInput('user_mentions must be an array.')
    for (const entry of rawUserMentions) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each user_mention must be {mentioned_user_id, mentioned_username}.')
      }
      const rec = entry as { mentioned_user_id?: unknown; mentioned_username?: unknown }
      if (typeof rec.mentioned_user_id !== 'string') {
        return badInput('Each user_mention mentioned_user_id must be a string.')
      }
      if (typeof rec.mentioned_username !== 'string') {
        return badInput('Each user_mention mentioned_username must be a string.')
      }
      userMentions.push({
        mentionedUserId: rec.mentioned_user_id,
        mentionedUsername: rec.mentioned_username,
      })
    }
  }

  let coverImageHash: string | null = null
  if (payload.cover_image_hash !== undefined && payload.cover_image_hash !== null) {
    if (typeof payload.cover_image_hash !== 'string') {
      return badInput('cover_image_hash must be a string or null.')
    }
    coverImageHash = payload.cover_image_hash
  }

  const result = await updateDraft(id, session.forumUserId, {
    title,
    body,
    topicBadgeIds,
    images,
    citations,
    userMentions,
    coverImageHash,
  })
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound()
    return badInput(result.error ?? 'Could not update draft.')
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) return unauthorized()
  const { id } = await context.params
  if (!UUID_RE.test(id)) return badInput('Invalid draft id.')

  const result = await deleteDraft(id, session.forumUserId)
  return NextResponse.json({ ok: true, deleted: result.deleted })
}
