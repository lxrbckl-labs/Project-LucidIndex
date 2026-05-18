/**
 * POST /api/forum/drafts
 *
 * Creates a new forum post draft for the current forum user. The body
 * shape matches `POST /api/forum/posts` so the composer can reuse the
 * same payload-building code:
 *
 *   {
 *     title: string,
 *     body: string,
 *     topic_badge_ids: string[],
 *     images: Array<{ hash: string, mime: string }>
 *   }
 *
 * Drafts are intentionally permissive — no length checks, no topic
 * existence checks. The POST step is where those run. Validation here
 * is limited to shape + image hash/mime sanity (so the row can land in
 * `forum_post_draft_images` without tripping CHECK constraints).
 *
 * Responses:
 *   - 200 `{ ok: true, draft_id }` on success.
 *   - 400 `invalid_input` with an `error` string.
 *   - 401 `unauthorized` — no forum session.
 */

import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  createDraft,
  type DraftCitation,
  type DraftImage,
  type DraftUserMention,
} from '@/app/forum/create/_lib/drafts-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type IncomingBody = {
  title?: unknown
  body?: unknown
  topic_badge_ids?: unknown
  images?: unknown
  citations?: unknown
  user_mentions?: unknown
}

function badInput(error: string) {
  return NextResponse.json({ ok: false, reason: 'invalid_input', error }, { status: 400 })
}

export async function POST(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  let payload: IncomingBody
  try {
    payload = (await req.json()) as IncomingBody
  } catch {
    return badInput('Request body is not valid JSON.')
  }

  // Tolerant string coercion — drafts allow empty title/body, so a
  // missing field gets treated as ''.
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

  const result = await createDraft(session.forumUserId, {
    title,
    body,
    topicBadgeIds,
    images,
    citations,
    userMentions,
  })
  if (!result.ok) {
    return badInput(result.error ?? 'Could not save draft.')
  }
  return NextResponse.json({ ok: true, draft_id: result.draftId })
}
