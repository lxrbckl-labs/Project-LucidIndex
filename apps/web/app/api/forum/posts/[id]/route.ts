/**
 * PATCH /api/forum/posts/[id]
 *
 * Edit a published forum post. Author-only — non-authors hit 404 (not
 * 403) so the existence of a post they can't edit isn't leaked. Body
 * mirrors the create endpoint at `/api/forum/posts`:
 *   {
 *     title, body, topic_badge_ids, images, citations, user_mentions
 *   }
 *
 * One transaction rebuilds the join tables (topics, images, citations,
 * user mentions) by DELETE + INSERT — internal restructuring, not data
 * loss. The post row itself, its view tally, its star set, and its
 * edit history all stay intact. NO DELETIONS posture is preserved at
 * the record-of-truth level (forum_posts, forum_post_views,
 * forum_post_stars, forum_post_edits) — only the per-edit join sets
 * get rewritten. An `INSERT INTO forum_post_edits (post_id)` row stamps
 * the edit timestamp for the history surface.
 *
 * Underlying image bytes are content-addressed and shared across posts;
 * removing an image's row here doesn't touch the file on disk. Orphan
 * bytes are fine — they're shared infrastructure.
 *
 * Responses:
 *   - 200 `{ ok: true }` on success
 *   - 400 invalid_input
 *   - 401 unauthorized
 *   - 404 not_found (post doesn't exist OR viewer isn't the author)
 *   - 404 unknown_topic / unknown_cited_post / unknown_mentioned_user
 *   - 500 db_error
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, inArray } from '@lucidindex/db/query'
import {
  forumPostCitations,
  forumPostEdits,
  forumPostImages,
  forumPosts,
  forumPostTopics,
  forumPostUserMentions,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HASH_RE = /^[a-f0-9]{64}$/
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

type ImageRef = { hash: string; mime: string }
type CitationRef = { citedPostId: string; sequenceNumber: number }
type UserMentionRef = { mentionedUserId: string; mentionedUsername: string }

type IncomingBody = {
  title?: unknown
  body?: unknown
  topic_badge_ids?: unknown
  images?: unknown
  citations?: unknown
  user_mentions?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function collectReferencedSequences(body: string, kind: 'Image' | 'Post'): Set<number> {
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

function notFound() {
  return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const authorId = session.forumUserId

  const { id: postId } = await context.params
  if (!UUID_RE.test(postId)) return badInput('Invalid post id.')

  // Verify the row exists AND the session user is the author. We collapse
  // "missing" and "wrong author" into the same 404 so a non-author can't
  // probe for the existence of a post they don't own.
  const existing = await db
    .select({ id: forumPosts.id, authorId: forumPosts.authorId })
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1)
  const row = existing[0]
  if (!row || row.authorId !== authorId) return notFound()

  let payload: IncomingBody
  try {
    payload = (await req.json()) as IncomingBody
  } catch {
    return badInput('Request body is not valid JSON.')
  }

  const title = asString(payload.title)?.trim() ?? ''
  const body = asString(payload.body) ?? ''

  if (!title) return badInput('Title is required.')
  if (!body.trim()) return badInput('Body is required.')

  const rawTopicIds = payload.topic_badge_ids
  let topicIds: string[] = []
  if (rawTopicIds !== undefined && rawTopicIds !== null) {
    if (!Array.isArray(rawTopicIds)) return badInput('topic_badge_ids must be an array.')
    for (const id of rawTopicIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return badInput('Each topic id must be a UUID.')
      }
      topicIds.push(id)
    }
    topicIds = Array.from(new Set(topicIds))
  }

  const rawImages = payload.images
  const images: ImageRef[] = []
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages)) return badInput('images must be an array.')
    for (const entry of rawImages) {
      if (!entry || typeof entry !== 'object') {
        return badInput('Each image must be an object with hash + mime.')
      }
      const rec = entry as { hash?: unknown; mime?: unknown }
      const hash = asString(rec.hash)
      const mime = asString(rec.mime)
      if (!hash || !HASH_RE.test(hash)) {
        return badInput('Each image hash must be a sha256 hex string.')
      }
      if (!mime || !ALLOWED_MIME.has(mime)) {
        return badInput('Each image mime must be one of png / jpeg / webp / gif.')
      }
      images.push({ hash, mime })
    }
  }

  const rawCitations = payload.citations
  const rawCitationList: CitationRef[] = []
  if (rawCitations !== undefined && rawCitations !== null) {
    if (!Array.isArray(rawCitations)) return badInput('citations must be an array.')
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
      if (seq < 1) return badInput('Each citation sequence_number must be >= 1.')
      // Editing a post must not let a citation point at itself.
      if (citedId === postId) return badInput('A post cannot cite itself.')
      if (seenCitedIds.has(citedId)) {
        return badInput('Each post may be cited at most once per post.')
      }
      if (seenSequences.has(seq)) {
        return badInput('Each citation sequence_number must be unique within the post.')
      }
      seenCitedIds.add(citedId)
      seenSequences.add(seq)
      rawCitationList.push({ citedPostId: citedId, sequenceNumber: seq })
    }
  }

  const bodyReferencedSequences = collectReferencedSequences(body, 'Post')
  const citations: CitationRef[] = rawCitationList.filter((c) =>
    bodyReferencedSequences.has(c.sequenceNumber),
  )

  const rawUserMentions = payload.user_mentions
  const rawUserMentionList: UserMentionRef[] = []
  if (rawUserMentions !== undefined && rawUserMentions !== null) {
    if (!Array.isArray(rawUserMentions)) return badInput('user_mentions must be an array.')
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
        return badInput('Each user may be mentioned at most once per post.')
      }
      seenMentionedIds.add(mid)
      rawUserMentionList.push({ mentionedUserId: mid, mentionedUsername: uname })
    }
  }

  const noSelfList = rawUserMentionList.filter((m) => m.mentionedUserId !== authorId)

  const limits = await getPostingSettings()

  if (title.length > limits.maxTitleChars) {
    return badInput(`Title is ${title.length} characters; max allowed is ${limits.maxTitleChars}.`)
  }
  if (body.length > limits.maxBodyChars) {
    return badInput(`Body is ${body.length} characters; max allowed is ${limits.maxBodyChars}.`)
  }
  if (topicIds.length > limits.maxTopicsPerPost) {
    return badInput(
      `Post would carry ${topicIds.length} topics; max allowed is ${limits.maxTopicsPerPost}.`,
    )
  }
  if (images.length > limits.maxImagesPerPost) {
    return badInput(
      `Post would carry ${images.length} images; max allowed is ${limits.maxImagesPerPost}.`,
    )
  }

  if (topicIds.length > 0) {
    const existingTopics = await db
      .select({ id: topicBadges.id })
      .from(topicBadges)
      .where(inArray(topicBadges.id, topicIds))
    const existingSet = new Set(existingTopics.map((r) => r.id))
    const missing = topicIds.filter((id) => !existingSet.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'unknown_topic',
          error: `Unknown topic id(s): ${missing.join(', ')}.`,
        },
        { status: 404 },
      )
    }
  }

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

  // Atomic rebuild: replace title/body, blow away & reinsert the join
  // tables, stamp the edit history row. The DELETE-then-INSERT pattern
  // on join tables is internal restructuring — the post + its history
  // surfaces (views, stars, edits) all stay intact. See route comment
  // for the full NO DELETIONS reasoning.
  try {
    await db.transaction(async (tx) => {
      await tx.update(forumPosts).set({ title, body }).where(eq(forumPosts.id, postId))

      await tx.delete(forumPostTopics).where(eq(forumPostTopics.postId, postId))
      if (topicIds.length > 0) {
        await tx.insert(forumPostTopics).values(
          topicIds.map((topicBadgeId) => ({
            postId,
            topicBadgeId,
          })),
        )
      }

      await tx.delete(forumPostImages).where(eq(forumPostImages.postId, postId))
      if (images.length > 0) {
        await tx.insert(forumPostImages).values(
          images.map((img, idx) => ({
            postId,
            imageHash: img.hash,
            sequenceNumber: idx + 1,
            mime: img.mime,
            uploadedByUserId: authorId,
          })),
        )
      }

      await tx.delete(forumPostCitations).where(eq(forumPostCitations.postId, postId))
      if (citations.length > 0) {
        await tx.insert(forumPostCitations).values(
          citations.map((c) => ({
            postId,
            citedPostId: c.citedPostId,
            sequenceNumber: c.sequenceNumber,
          })),
        )
      }

      await tx.delete(forumPostUserMentions).where(eq(forumPostUserMentions.postId, postId))
      if (userMentions.length > 0) {
        await tx.insert(forumPostUserMentions).values(
          userMentions.map((m) => ({
            postId,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
          })),
        )
      }

      // Append-only edit log — one row per save. `edited_at` defaults
      // to now() so we don't pass it explicitly.
      await tx.insert(forumPostEdits).values({ postId })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return NextResponse.json({ ok: false, reason: 'db_error', error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
