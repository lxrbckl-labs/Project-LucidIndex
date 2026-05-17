/**
 * Server-only data helpers for forum post drafts.
 *
 * Owns every read/write against `forum_post_drafts` + `forum_post_draft_images`.
 * Every mutating path takes a `userId` and refuses to operate on a row
 * whose `author_id` doesn't match — the API layer relies on this for
 * authorization rather than reimplementing the check at each endpoint.
 *
 * Drafts are intentionally permissive about content shape: empty strings
 * are allowed, length isn't checked, topic existence isn't verified. The
 * `POST /api/forum/posts` step is where validation against
 * `forum_settings` and topic-existence checks happen — the draft just
 * preserves whatever intermediate state the composer is in.
 */

import 'server-only'
import { db } from '@lucidindex/db/client'
import { and, desc, eq, sql } from '@lucidindex/db/query'
import { forumPostDraftImages, forumPostDrafts } from '@lucidindex/db/schema'

const HASH_RE = /^[a-f0-9]{64}$/
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export type DraftImage = {
  hash: string
  mime: string
}

export type DraftRow = {
  id: string
  title: string
  body: string
  topicBadgeIds: string[]
  createdAt: Date
  updatedAt: Date
}

export type DraftInput = {
  title: string
  body: string
  topicBadgeIds: string[]
  images: DraftImage[]
}

export type DraftSummary = {
  id: string
  title: string
  updatedAt: Date
}

export type RepoOk<T = unknown> = T extends void ? { ok: true } : { ok: true } & T
export type RepoErr<R extends string = string> = { ok: false; reason: R; error?: string }

/**
 * Validate the input shape used by create/update. Returns a friendly
 * error string on first failure. The caller (route handler) maps this
 * to a 400 response.
 *
 * Drafts allow empty title/body and skip the per-post length caps from
 * `forum_settings` — those are enforced on the POST step. We DO sanity-
 * check image hash + mime so the row that lands in
 * `forum_post_draft_images` can't violate its CHECK constraints.
 */
function validateInput(input: DraftInput): { ok: true } | { ok: false; error: string } {
  if (typeof input.title !== 'string') return { ok: false, error: 'title must be a string.' }
  if (typeof input.body !== 'string') return { ok: false, error: 'body must be a string.' }
  if (!Array.isArray(input.topicBadgeIds)) {
    return { ok: false, error: 'topic_badge_ids must be an array.' }
  }
  for (const t of input.topicBadgeIds) {
    if (typeof t !== 'string') return { ok: false, error: 'Each topic id must be a string.' }
  }
  if (!Array.isArray(input.images)) {
    return { ok: false, error: 'images must be an array.' }
  }
  // Image rows enforce a UNIQUE(draft_id, sequence_number); the
  // sequence is the array index + 1 so callers can't trip the constraint
  // by passing duplicates as long as we de-dupe per-position. Hash + mime
  // ranges mirror the schema CHECKs.
  for (const img of input.images) {
    if (!img || typeof img !== 'object') {
      return { ok: false, error: 'Each image must be {hash, mime}.' }
    }
    if (typeof img.hash !== 'string' || !HASH_RE.test(img.hash)) {
      return { ok: false, error: 'Each image hash must be a sha256 hex string.' }
    }
    if (typeof img.mime !== 'string' || !ALLOWED_MIME.has(img.mime)) {
      return { ok: false, error: 'Each image mime must be png/jpeg/webp/gif.' }
    }
  }
  return { ok: true }
}

/**
 * Light-shape list for the sidebar. Returns only the fields needed to
 * render a sidebar row (id, title, updatedAt). Sorted by most-recently-
 * updated first so the user's freshest work surfaces at the top.
 */
export async function listDraftsForUser(userId: string): Promise<DraftSummary[]> {
  const rows = await db
    .select({
      id: forumPostDrafts.id,
      title: forumPostDrafts.title,
      updatedAt: forumPostDrafts.updatedAt,
    })
    .from(forumPostDrafts)
    .where(eq(forumPostDrafts.authorId, userId))
    .orderBy(desc(forumPostDrafts.updatedAt))
  return rows
}

/**
 * Full-shape read for the composer. Returns null when the draft doesn't
 * exist OR when the requesting user isn't the author — collapsing both
 * cases to a single null prevents probing for valid draft ids across
 * users.
 */
export async function getDraftForUser(
  id: string,
  userId: string,
): Promise<{ draft: DraftRow; images: DraftImage[] } | null> {
  const rows = await db
    .select({
      id: forumPostDrafts.id,
      title: forumPostDrafts.title,
      body: forumPostDrafts.body,
      topicBadgeIds: forumPostDrafts.topicBadgeIds,
      createdAt: forumPostDrafts.createdAt,
      updatedAt: forumPostDrafts.updatedAt,
    })
    .from(forumPostDrafts)
    .where(and(eq(forumPostDrafts.id, id), eq(forumPostDrafts.authorId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const images = await db
    .select({
      hash: forumPostDraftImages.imageHash,
      mime: forumPostDraftImages.mime,
      sequenceNumber: forumPostDraftImages.sequenceNumber,
    })
    .from(forumPostDraftImages)
    .where(eq(forumPostDraftImages.draftId, id))
    .orderBy(forumPostDraftImages.sequenceNumber)

  return {
    draft: row,
    images: images.map((i) => ({ hash: i.hash, mime: i.mime })),
  }
}

/**
 * Insert a new draft + its image rows in one transaction. Returns the
 * new draft id so the composer can `router.replace` to
 * `/forum/create?draft=<id>` and subsequent saves PATCH the same row.
 */
export async function createDraft(
  userId: string,
  input: DraftInput,
): Promise<{ ok: true; draftId: string } | RepoErr<'invalid_input'>> {
  const v = validateInput(input)
  if (!v.ok) return { ok: false, reason: 'invalid_input', error: v.error }

  try {
    const draftId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(forumPostDrafts)
        .values({
          authorId: userId,
          title: input.title,
          body: input.body,
          topicBadgeIds: input.topicBadgeIds,
        })
        .returning({ id: forumPostDrafts.id })
      const row = inserted[0]
      if (!row) throw new Error('Draft insert returned no rows.')
      if (input.images.length > 0) {
        await tx.insert(forumPostDraftImages).values(
          input.images.map((img, idx) => ({
            draftId: row.id,
            imageHash: img.hash,
            sequenceNumber: idx + 1,
            mime: img.mime,
          })),
        )
      }
      return row.id
    })
    return { ok: true, draftId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return { ok: false, reason: 'invalid_input', error: message }
  }
}

/**
 * Replace every field of an existing draft, including its image set.
 * Ownership is enforced via the WHERE clause on the UPDATE; if no row
 * matches `(id, author_id)` the function returns `not_found` (covers
 * both nonexistent draft AND wrong-owner cases — same posture as
 * `getDraftForUser`).
 *
 * Image set is rebuilt with DELETE-then-INSERT inside the transaction —
 * simpler than a diff-based merge and the draft sets are small (capped
 * by the post-image setting at the application boundary).
 */
export async function updateDraft(
  id: string,
  userId: string,
  input: DraftInput,
): Promise<{ ok: true } | RepoErr<'invalid_input' | 'not_found'>> {
  const v = validateInput(input)
  if (!v.ok) return { ok: false, reason: 'invalid_input', error: v.error }

  try {
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(forumPostDrafts)
        .set({
          title: input.title,
          body: input.body,
          topicBadgeIds: input.topicBadgeIds,
          updatedAt: sql`now()`,
        })
        .where(and(eq(forumPostDrafts.id, id), eq(forumPostDrafts.authorId, userId)))
        .returning({ id: forumPostDrafts.id })
      if (updated.length === 0) {
        return { ok: false as const, reason: 'not_found' as const }
      }
      await tx.delete(forumPostDraftImages).where(eq(forumPostDraftImages.draftId, id))
      if (input.images.length > 0) {
        await tx.insert(forumPostDraftImages).values(
          input.images.map((img, idx) => ({
            draftId: id,
            imageHash: img.hash,
            sequenceNumber: idx + 1,
            mime: img.mime,
          })),
        )
      }
      return { ok: true as const }
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error.'
    return { ok: false, reason: 'invalid_input', error: message }
  }
}

/**
 * Delete a draft. Cascade handles draft_images. `deleted` is `false`
 * when no row matched (already gone, or never existed, or wrong owner)
 * — collapsing the wrong-owner case into `deleted: false` matches the
 * silent posture used elsewhere in this repo.
 */
export async function deleteDraft(
  id: string,
  userId: string,
): Promise<{ ok: true; deleted: boolean }> {
  const result = await db
    .delete(forumPostDrafts)
    .where(and(eq(forumPostDrafts.id, id), eq(forumPostDrafts.authorId, userId)))
    .returning({ id: forumPostDrafts.id })
  return { ok: true, deleted: result.length > 0 }
}
