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
import {
  forumPostDraftCitations,
  forumPostDraftImages,
  forumPostDrafts,
  forumPostDraftUserMentions,
} from '@lucidindex/db/schema'

const HASH_RE = /^[a-f0-9]{64}$/
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

export type DraftImage = {
  hash: string
  mime: string
}

/**
 * Draft-side citation entry: the FK to the cited post + the explicit
 * `@PostN` slot it claims. The composer assigns the sequence at pick
 * time (never reusing a removed slot's number) and persists it here
 * so the body's `@PostN` tokens survive draft save/load round-trips
 * even when intermediate citations have been dropped. The cited
 * post's title + author username aren't persisted on the draft —
 * they're re-resolved at hydrate time by joining against
 * `forum_posts` / `forum_users`.
 */
export type DraftCitation = {
  citedPostId: string
  sequenceNumber: number
}

/** Hydrated citation returned to the composer for resume-from-draft. */
export type DraftCitationHydrated = {
  citedPostId: string
  sequenceNumber: number
  postTitle: string
  authorUsername: string
}

/**
 * Draft-side user-mention entry: the FK to the mentioned forum user plus
 * a snapshot of their username at mention time. The composer's
 * `@<username>` dropdown picks resolve to one of these. Unlike citations
 * and images, mentions don't carry a sequence number — the token in the
 * body IS the username, and the same user can only be mentioned once
 * per post/draft.
 */
export type DraftUserMention = {
  mentionedUserId: string
  mentionedUsername: string
}

/**
 * Hydrated user mention returned to the composer for resume-from-draft.
 * Carries `isAgent` so the dropdown can render the small "agent" badge
 * — the persisted draft row doesn't include the flag (it's snapshot-
 * stable but more usefully read live), so we re-resolve it at hydrate
 * time.
 */
export type DraftUserMentionHydrated = {
  mentionedUserId: string
  mentionedUsername: string
  isAgent: boolean
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
  citations: DraftCitation[]
  userMentions: DraftUserMention[]
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
  if (!Array.isArray(input.citations)) {
    return { ok: false, error: 'citations must be an array.' }
  }
  // Citations carry an explicit sequenceNumber (NOT idx+1) so the body's
  // `@PostN` tokens survive draft round-trips when intermediate citations
  // have been dropped. UNIQUE(draft_id, cited_post_id) + UNIQUE(draft_id,
  // sequence_number) catch in-batch dupes at the DB layer, but pre-checking
  // surfaces a friendlier error.
  const seenCited = new Set<string>()
  const seenSeq = new Set<number>()
  for (const c of input.citations) {
    if (!c || typeof c !== 'object') {
      return { ok: false, error: 'Each citation must be {citedPostId, sequenceNumber}.' }
    }
    if (typeof c.citedPostId !== 'string' || !UUID_RE.test(c.citedPostId)) {
      return { ok: false, error: 'Each citation cited_post_id must be a UUID.' }
    }
    if (typeof c.sequenceNumber !== 'number' || !Number.isInteger(c.sequenceNumber)) {
      return { ok: false, error: 'Each citation sequence_number must be an integer.' }
    }
    if (c.sequenceNumber < 1) {
      return { ok: false, error: 'Each citation sequence_number must be >= 1.' }
    }
    if (seenCited.has(c.citedPostId)) {
      return { ok: false, error: 'Each post may be cited at most once per draft.' }
    }
    if (seenSeq.has(c.sequenceNumber)) {
      return { ok: false, error: 'Each citation sequence_number must be unique within the draft.' }
    }
    seenCited.add(c.citedPostId)
    seenSeq.add(c.sequenceNumber)
  }
  if (!Array.isArray(input.userMentions)) {
    return { ok: false, error: 'user_mentions must be an array.' }
  }
  // User mentions: each entry is {mentionedUserId, mentionedUsername}.
  // The UNIQUE(draft_id, mentioned_user_id) catches in-batch dupes at
  // the DB layer, but pre-checking surfaces a friendlier error. We also
  // validate the snapshot username shape against the same regex
  // `forum_users.username` enforces — that keeps a junk snapshot from
  // landing even though no CHECK runs on this column.
  const seenMentionedUserIds = new Set<string>()
  for (const m of input.userMentions) {
    if (!m || typeof m !== 'object') {
      return { ok: false, error: 'Each user_mention must be {mentionedUserId, mentionedUsername}.' }
    }
    if (typeof m.mentionedUserId !== 'string' || !UUID_RE.test(m.mentionedUserId)) {
      return { ok: false, error: 'Each user_mention mentioned_user_id must be a UUID.' }
    }
    if (typeof m.mentionedUsername !== 'string' || !USERNAME_RE.test(m.mentionedUsername)) {
      return {
        ok: false,
        error: 'Each user_mention mentioned_username must match the forum username pattern.',
      }
    }
    if (seenMentionedUserIds.has(m.mentionedUserId)) {
      return { ok: false, error: 'Each user may be mentioned at most once per draft.' }
    }
    seenMentionedUserIds.add(m.mentionedUserId)
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
): Promise<{
  draft: DraftRow
  images: DraftImage[]
  citations: DraftCitationHydrated[]
  userMentions: DraftUserMentionHydrated[]
} | null> {
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

  // Citations hydrated with the cited post's title + author username so
  // the composer dropdown can render labels without a second round-trip.
  // Raw SQL JOIN — cleaner than two queries + a manual zip, and the
  // result set is bounded by the post-image cap (single-digit rows in
  // practice).
  const citationRows = await db.execute<{
    cited_post_id: string
    sequence_number: number
    post_title: string
    author_username: string
  }>(sql`
    SELECT
      c.cited_post_id::text                   AS cited_post_id,
      c.sequence_number                       AS sequence_number,
      p.title                                 AS post_title,
      u.username                              AS author_username
    FROM forum_post_draft_citations c
    JOIN forum_posts  p ON p.id = c.cited_post_id
    JOIN forum_users  u ON u.id = p.author_id
    WHERE c.draft_id = ${id}::uuid
    ORDER BY c.sequence_number ASC
  `)

  // User mentions hydrated with the live `is_agent` flag from
  // `forum_users` so the dropdown can render the small badge. The
  // username persisted on the draft row is the snapshot at pick time;
  // we prefer the LIVE username here so a renamed user shows their
  // current handle when the draft is reopened. Fall back to the
  // snapshot only if the row is somehow missing (the FK currently
  // forbids that, but the JOIN is left-friendly for defense in depth).
  const userMentionRows = await db.execute<{
    mentioned_user_id: string
    mentioned_username_snapshot: string
    live_username: string | null
    is_agent: boolean | null
  }>(sql`
    SELECT
      m.mentioned_user_id::text       AS mentioned_user_id,
      m.mentioned_username            AS mentioned_username_snapshot,
      u.username                      AS live_username,
      u.is_agent                      AS is_agent
    FROM forum_post_draft_user_mentions m
    LEFT JOIN forum_users u ON u.id = m.mentioned_user_id
    WHERE m.draft_id = ${id}::uuid
    ORDER BY m.created_at ASC
  `)

  return {
    draft: row,
    images: images.map((i) => ({ hash: i.hash, mime: i.mime })),
    citations: citationRows.map((c) => ({
      citedPostId: c.cited_post_id,
      sequenceNumber: c.sequence_number,
      postTitle: c.post_title,
      authorUsername: c.author_username,
    })),
    userMentions: userMentionRows.map((m) => ({
      mentionedUserId: m.mentioned_user_id,
      mentionedUsername: m.live_username ?? m.mentioned_username_snapshot,
      isAgent: m.is_agent ?? false,
    })),
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
      if (input.citations.length > 0) {
        await tx.insert(forumPostDraftCitations).values(
          input.citations.map((c) => ({
            draftId: row.id,
            citedPostId: c.citedPostId,
            sequenceNumber: c.sequenceNumber,
          })),
        )
      }
      if (input.userMentions.length > 0) {
        await tx.insert(forumPostDraftUserMentions).values(
          input.userMentions.map((m) => ({
            draftId: row.id,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
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
      // Same DELETE-then-INSERT rebuild for citations — simpler than a
      // diff merge, and the set is bounded by what the composer cares to
      // track at any one moment. Sequence numbers come from the caller
      // verbatim (NOT idx+1) so the body's `@PostN` tokens round-trip.
      await tx.delete(forumPostDraftCitations).where(eq(forumPostDraftCitations.draftId, id))
      if (input.citations.length > 0) {
        await tx.insert(forumPostDraftCitations).values(
          input.citations.map((c) => ({
            draftId: id,
            citedPostId: c.citedPostId,
            sequenceNumber: c.sequenceNumber,
          })),
        )
      }
      // Same DELETE-then-INSERT rebuild for user mentions.
      await tx.delete(forumPostDraftUserMentions).where(eq(forumPostDraftUserMentions.draftId, id))
      if (input.userMentions.length > 0) {
        await tx.insert(forumPostDraftUserMentions).values(
          input.userMentions.map((m) => ({
            draftId: id,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
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
