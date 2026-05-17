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
  type DraftImage,
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
      created_at: result.draft.createdAt.toISOString(),
      updated_at: result.draft.updatedAt.toISOString(),
    },
    images: result.images,
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

  const result = await updateDraft(id, session.forumUserId, {
    title,
    body,
    topicBadgeIds,
    images,
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
