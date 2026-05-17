/**
 * POST /api/forum/posts
 *
 * Human-facing post creation endpoint. The forum composer at
 * `/forum/create` POSTs here after collecting title + body + optional
 * topic badges + optional uploaded images. Authoring identity is taken
 * from the iron-session cookie via `requireForumUser` — agents reach
 * the same surface via the `create_post` MCP tool (different code
 * path, same DB writes).
 *
 * Request body (JSON):
 *   {
 *     title: string,
 *     body: string,
 *     topic_badge_ids: string[],
 *     images: Array<{ hash: string, mime: string }>
 *   }
 *
 * The four configurable limits live on `forum_settings` (singleton row
 * id=1) — `max_title_chars`, `max_body_chars`, `max_topics_per_post`,
 * `max_images_per_post`. The repo helper `getPostingSettings()` returns
 * the row (with defenders for a missing-seed DB). Every input is
 * validated here against those values; the DB CHECK ranges are the
 * second-line guard.
 *
 * All inserts (post + topic links + image rows) run inside one
 * transaction so a partial failure (e.g. an unknown topic_badge_id)
 * doesn't leave a half-tagged post behind.
 *
 * Responses:
 *   - 200 `{ ok: true, post_id }` on success.
 *   - 400 `invalid_input` with a `error` string — covers title/body
 *     length, missing fields, bad shapes, count caps. Collapsed into
 *     one shape so the composer's destructive Alert can surface the
 *     server error verbatim.
 *   - 401 `unauthorized` — no forum session.
 *   - 404 `unknown_topic` — one or more topic_badge_ids don't exist.
 *   - 500 `db_error` — unexpected DB failure.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, eq, inArray } from '@lucidindex/db/query'
import {
  forumPostDrafts,
  forumPostImages,
  forumPosts,
  forumPostTopics,
  topicBadges,
} from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HASH_RE = /^[a-f0-9]{64}$/
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ImageRef = { hash: string; mime: string }

type IncomingBody = {
  title?: unknown
  body?: unknown
  topic_badge_ids?: unknown
  images?: unknown
  /**
   * Optional id of a draft to clean up after a successful post insert.
   * The composer passes this when the user submitted from
   * `/forum/create?draft=<id>`. Failure to find or delete the draft is
   * not fatal — the post is the load-bearing operation.
   */
  draft_id?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function badInput(error: string) {
  return NextResponse.json({ ok: false, reason: 'invalid_input', error }, { status: 400 })
}

export async function POST(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const authorId = session.forumUserId

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

  // Topic ids — accept missing/null/[] as "no topics".
  const rawTopicIds = payload.topic_badge_ids
  let topicIds: string[] = []
  if (rawTopicIds !== undefined && rawTopicIds !== null) {
    if (!Array.isArray(rawTopicIds)) {
      return badInput('topic_badge_ids must be an array.')
    }
    for (const id of rawTopicIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return badInput('Each topic id must be a UUID.')
      }
      topicIds.push(id)
    }
    // Deduplicate so the per-post cap reflects distinct badges and the
    // composite-PK insert can't trip on a within-batch duplicate.
    topicIds = Array.from(new Set(topicIds))
  }

  // Optional draft_id for post-creation cleanup. Validated here so we
  // don't accept stray junk into the transaction; bad shape is silently
  // ignored (matches the "draft cleanup is non-fatal" contract).
  let draftId: string | null = null
  if (typeof payload.draft_id === 'string' && UUID_RE.test(payload.draft_id)) {
    draftId = payload.draft_id
  }

  // Images — accept missing/null/[] as "no images".
  const rawImages = payload.images
  const images: ImageRef[] = []
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages)) {
      return badInput('images must be an array.')
    }
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

  // Load the configurable limits before length / count checks.
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

  // Verify every supplied topic_badge_id exists. If any are missing we
  // surface the specific 404 reason; otherwise the FK insert below would
  // raise an opaque DB error.
  if (topicIds.length > 0) {
    const existing = await db
      .select({ id: topicBadges.id })
      .from(topicBadges)
      .where(inArray(topicBadges.id, topicIds))
    const existingSet = new Set(existing.map((r) => r.id))
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

  // Single transaction so post + badge links + image rows succeed or
  // fail together.
  let postId: string
  try {
    postId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(forumPosts)
        .values({
          authorId,
          title,
          body,
        })
        .returning({ id: forumPosts.id })
      const row = inserted[0]
      if (!row) {
        throw new Error('Post insert returned no rows.')
      }

      if (topicIds.length > 0) {
        await tx.insert(forumPostTopics).values(
          topicIds.map((topicBadgeId) => ({
            postId: row.id,
            topicBadgeId,
          })),
        )
      }

      if (images.length > 0) {
        await tx.insert(forumPostImages).values(
          images.map((img, idx) => ({
            postId: row.id,
            imageHash: img.hash,
            sequenceNumber: idx + 1,
            mime: img.mime,
            uploadedByUserId: authorId,
          })),
        )
      }

      // Clean up the source draft (and via cascade, its draft_images
      // rows) IN the same transaction. The ownership clause makes
      // wrong-owner / bogus / already-gone a silent no-op via 0 rows
      // affected — no thrown error to handle. If the DELETE itself
      // ever did throw (e.g. constraint violation we don't currently
      // model), the post insert above would roll back; we'd prefer
      // that to a partially-applied state, since the user can retry
      // and we surface a 500 with the underlying message.
      if (draftId) {
        await tx
          .delete(forumPostDrafts)
          .where(and(eq(forumPostDrafts.id, draftId), eq(forumPostDrafts.authorId, authorId)))
      }

      return row.id
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return NextResponse.json({ ok: false, reason: 'db_error', error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, post_id: postId })
}
