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
  forumPostCitations,
  forumPostDrafts,
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
  /**
   * Citation set the composer picked via the `@`-dropdown. Each entry
   * pins one `@PostN` slot to a cited post id. The handler filters out
   * entries whose `@PostN` token never appears in the body — same
   * lifecycle policy as drafts (citations exist only as long as their
   * token is in the body). Empty / missing is treated as "no citations".
   */
  citations?: unknown
  /**
   * User-mention set the composer picked via the `@`-dropdown's Users
   * section. Each entry carries the mentioned user id + the username
   * snapshot the composer wrote into the body. Same lifecycle policy
   * as citations: the handler keeps only entries whose `@<username>`
   * token actually appears in the body. Empty / missing = no mentions.
   */
  user_mentions?: unknown
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

/**
 * Walk the body and return every distinct integer N where `@<Kind>N`
 * appears at a word boundary. Used for both `@ImageN` and `@PostN`
 * extraction. Mirrors the composer's `referencedSequences` regex so
 * client + server agree on what counts as a reference.
 */
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

  // Citations — accept missing/null/[] as "no citations". Each entry
  // carries the cited post id and the `@PostN` sequence number it
  // claims. We filter unused entries (token absent from body) below
  // after we have the body in hand; here we validate shape only.
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

  // Filter unused citations — keep only those whose `@PostN` token
  // actually appears in the body. The composer's lifecycle is "citations
  // exist as long as the body references them"; submit-time the server
  // makes the same call so deleted-but-still-in-state entries don't land.
  const bodyReferencedSequences = collectReferencedSequences(body, 'Post')
  const citations: CitationRef[] = rawCitationList.filter((c) =>
    bodyReferencedSequences.has(c.sequenceNumber),
  )

  // User mentions — accept missing/null/[] as "no mentions". Each entry
  // carries the mentioned user id and a username snapshot. The username
  // is validated against the same regex `forum_users.username` enforces;
  // duplicates within the batch are rejected pre-DB for a friendlier
  // error than the UNIQUE-constraint trip-up.
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
        return badInput('Each user may be mentioned at most once per post.')
      }
      seenMentionedIds.add(mid)
      rawUserMentionList.push({ mentionedUserId: mid, mentionedUsername: uname })
    }
  }

  // Self-mention is silently dropped — same posture as the composer's
  // dropdown which excludes the current user.
  const noSelfList = rawUserMentionList.filter((m) => m.mentionedUserId !== authorId)

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

  // User-mention existence + live-username lookup. We persist the
  // SNAPSHOT username (what the author wrote into the body) but
  // verify the live row exists; a stale snapshot whose live username
  // has been edited still resolves through the id. The token-in-body
  // filter that follows uses the SNAPSHOT — that's the literal
  // `@<username>` the body contains.
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
    // Filter to mentions whose `@<username>` token actually appears in
    // the body. Match on word boundary — the same posture the
    // composer's regex uses for live filtering, and matches the body
    // tokenizer on the render side.
    userMentions = noSelfList.filter((m) => {
      // Escape regex specials in the username; hyphen is the only
      // realistic culprit and only meaningful inside a char class,
      // but defensive code is cheap here.
      const escaped = m.mentionedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\B@${escaped}\\b`)
      return re.test(body)
    })
  }

  // Same up-front existence check for citation targets. The FK on
  // `forum_post_citations.cited_post_id` would catch a missing row in
  // the transaction, but pre-checking surfaces a specific 404 reason
  // instead of the opaque db_error path.
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

      // Citations land last so any FK / unique violation rolls back the
      // post + topics + images cleanly. Each row carries the specific
      // sequence_number from the client (NOT idx+1) — the composer
      // assigns slots as the user picks them and the body's `@PostN`
      // tokens are pinned to those numbers, so we must persist exactly
      // what was on the payload.
      if (citations.length > 0) {
        await tx.insert(forumPostCitations).values(
          citations.map((c) => ({
            postId: row.id,
            citedPostId: c.citedPostId,
            sequenceNumber: c.sequenceNumber,
          })),
        )
      }

      // User mentions — insert the SNAPSHOT username (what was written
      // in the body). Live username lookup happened above for existence
      // verification only; we deliberately store the snapshot so a
      // future username edit doesn't rewrite history.
      if (userMentions.length > 0) {
        await tx.insert(forumPostUserMentions).values(
          userMentions.map((m) => ({
            postId: row.id,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
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
