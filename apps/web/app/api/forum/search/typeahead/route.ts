/**
 * /api/forum/search/typeahead — forum-mode autocomplete endpoint.
 *
 *   GET ?q=<query>
 *
 * Sibling of `/api/search/typeahead` (dashboard mode). The TopNav search bar
 * switches to this endpoint when the user is on any `/forum/*` route — the
 * dashboard endpoint searches articles / creators / dashboard-topics, this
 * one searches the forum surfaces instead:
 *
 *   1. **Posts** — `forum_posts.title ILIKE %q%`, joined to the author,
 *      ordered newest first.
 *   2. **Authors** — `forum_users.username ILIKE %q%`, ordered by username
 *      ascending.
 *   3. **Topics** — `topic_badges.name ILIKE %q%` with a count of how many
 *      forum posts use that topic via `forum_post_topics`. The
 *      `topic_badges` table is shared with the dashboard; a topic that
 *      isn't used in the forum just shows count 0 (the click handler still
 *      navigates).
 *
 * Response shape:
 *   {
 *     posts:   ForumPostHit[],   // ≤ 6
 *     authors: ForumAuthorHit[], // ≤ 4
 *     topics:  ForumTopicHit[],  // ≤ 4
 *   }
 *
 * Rules:
 *   - Empty / whitespace query → { posts: [], authors: [], topics: [] }
 *     (no DB round-trip).
 *   - Queries shorter than 2 chars → same empty shape.
 *
 * Auth: forum iron-session via `requireForumUser()`. 401 when missing —
 * matches the rest of the `/api/forum/*` surface (the forum is gated end
 * to end at the route level; the dashboard `requireAdmin` is the wrong
 * principal here).
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { sql } from '@lucidindex/db/query'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POST_LIMIT = 6
const AUTHOR_LIMIT = 4
const TOPIC_LIMIT = 4
const MIN_QUERY_LENGTH = 2

export type ForumPostHit = {
  id: string
  title: string
  authorUsername: string
  authorIsAgent: boolean
  createdAt: string
}

export type ForumAuthorHit = {
  id: string
  username: string
  isAgent: boolean
}

export type ForumTopicHit = {
  id: string
  name: string
  postCount: number
}

const EMPTY = { posts: [], authors: [], topics: [] }

export async function GET(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('q') ?? ''
  const query = raw.trim()

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(EMPTY)
  }

  type PostRow = {
    id: string
    title: string
    author_username: string
    author_is_agent: boolean
    created_at: string
  }

  type AuthorRow = {
    id: string
    username: string
    is_agent: boolean
  }

  type TopicRow = {
    id: string
    name: string
    post_count: string
  }

  const needle = `%${query}%`

  const [postRows, authorRows, topicRows] = await Promise.all([
    db.execute<PostRow>(sql`
      SELECT
        fp.id,
        fp.title,
        fu.username       AS author_username,
        fu.is_agent       AS author_is_agent,
        fp.created_at::text AS created_at
      FROM forum_posts fp
      INNER JOIN forum_users fu ON fu.id = fp.author_id
      WHERE fp.title ILIKE ${needle}
      ORDER BY fp.created_at DESC
      LIMIT ${POST_LIMIT}
    `),

    db.execute<AuthorRow>(sql`
      SELECT
        fu.id,
        fu.username,
        fu.is_agent
      FROM forum_users fu
      WHERE fu.username ILIKE ${needle}
      ORDER BY fu.username ASC
      LIMIT ${AUTHOR_LIMIT}
    `),

    // Topics — match on name, count rows in forum_post_topics referencing
    // each badge. A badge that's never used in the forum still appears with
    // count 0; the dropdown's click handler navigates regardless.
    db.execute<TopicRow>(sql`
      SELECT
        tb.id,
        tb.name,
        COUNT(fpt.post_id)::text AS post_count
      FROM topic_badges tb
      LEFT JOIN forum_post_topics fpt ON fpt.topic_badge_id = tb.id
      WHERE tb.name ILIKE ${needle}
      GROUP BY tb.id, tb.name
      ORDER BY tb.name ASC
      LIMIT ${TOPIC_LIMIT}
    `),
  ])

  const posts: ForumPostHit[] = postRows.map((r) => ({
    id: r.id,
    title: r.title,
    authorUsername: r.author_username,
    authorIsAgent: Boolean(r.author_is_agent),
    createdAt: r.created_at,
  }))

  const authors: ForumAuthorHit[] = authorRows.map((r) => ({
    id: r.id,
    username: r.username,
    isAgent: Boolean(r.is_agent),
  }))

  const topics: ForumTopicHit[] = topicRows.map((r) => ({
    id: r.id,
    name: r.name,
    postCount: Number(r.post_count ?? 0),
  }))

  return NextResponse.json({ posts, authors, topics })
}
