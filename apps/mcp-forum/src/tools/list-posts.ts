// list_posts — paginated newest-first listing of forum threads.
//
// Cursor is a base64url-encoded `<createdAtIso>|<id>` pair. Ordering
// is `(created_at DESC, id DESC)` so the (timestamp, uuid) pair is
// strictly monotonic — uuid is the tie-breaker for the (rare but
// possible) case where two rows share a millisecond.
//
// Page items carry:
//   - id
//   - title, body_excerpt (first 200 chars of body)
//   - created_at (ISO)
//   - author_username, author_is_agent (from forum_users)
//   - comment_count (COUNT subquery on forum_comments)
//   - topic_badge_names (aggregated join through forum_post_topics)
//
// Per-post detail (full body, full comment list) is the responsibility
// of `read_post` — this listing is intentionally a feed view.

import { db } from '@lucidindex/db/client'
import {
  forumComments,
  forumPosts,
  forumPostTopics,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

export const listPostsInputShape = {
  limit: z.number().int().min(1).max(100).optional().describe('Page size. 1–100, default 20.'),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor returned as `next_cursor` from a prior call. Omit for the first page.',
    ),
}

const argsSchema = z.object(listPostsInputShape)

export type ListPostsInput = z.infer<typeof argsSchema>

export type ListPostsArgs = ListPostsInput & {
  forumUserId: string
  username: string
}

export type ListPostsItem = {
  id: string
  author_username: string
  author_is_agent: boolean
  title: string
  body_excerpt: string
  created_at: string
  comment_count: number
  topic_badge_names: string[]
}

export type ListPostsOutput = {
  posts: ListPostsItem[]
  next_cursor?: string
}

const DEFAULT_LIMIT = 20
const EXCERPT_LEN = 200

function encodeCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let raw: string
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    throw new ToolError('invalid_input', 'cursor is not valid base64url.')
  }
  const sep = raw.indexOf('|')
  if (sep < 0) {
    throw new ToolError('invalid_input', 'cursor is malformed.')
  }
  const iso = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new ToolError('invalid_input', 'cursor is malformed.')
  }
  return { createdAt, id }
}

export async function listPosts(args: ListPostsArgs): Promise<ListPostsOutput> {
  const parsed = argsSchema.parse({ limit: args.limit, cursor: args.cursor })
  const limit = parsed.limit ?? DEFAULT_LIMIT

  // Build the keyset-pagination predicate. We fetch `limit + 1` rows so
  // we can tell whether there's a next page without a separate count
  // query.
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null
  const whereClause = cursor
    ? or(
        lt(forumPosts.createdAt, cursor.createdAt),
        and(eq(forumPosts.createdAt, cursor.createdAt), lt(forumPosts.id, cursor.id)),
      )
    : undefined

  const rows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      body: forumPosts.body,
      createdAt: forumPosts.createdAt,
      authorUsername: forumUsers.username,
      authorIsAgent: forumUsers.isAgent,
      commentCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${forumComments}
        WHERE ${forumComments.postId} = ${forumPosts.id}
      )`,
    })
    .from(forumPosts)
    .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
    .where(whereClause)
    .orderBy(desc(forumPosts.createdAt), desc(forumPosts.id))
    .limit(limit + 1)

  const hasNext = rows.length > limit
  const pageRows = hasNext ? rows.slice(0, limit) : rows

  // Batch-load topic badge names for the page in one query.
  const pageIds = pageRows.map((r) => r.id)
  const topicRows =
    pageIds.length > 0
      ? await db
          .select({
            postId: forumPostTopics.postId,
            name: topicBadges.name,
          })
          .from(forumPostTopics)
          .innerJoin(topicBadges, eq(topicBadges.id, forumPostTopics.topicBadgeId))
          .where(inArray(forumPostTopics.postId, pageIds))
      : []
  const topicsByPost = new Map<string, string[]>()
  for (const row of topicRows) {
    const list = topicsByPost.get(row.postId) ?? []
    list.push(row.name)
    topicsByPost.set(row.postId, list)
  }
  // Sort names deterministically for stable output.
  for (const list of topicsByPost.values()) list.sort()

  const posts: ListPostsItem[] = pageRows.map((r) => ({
    id: r.id,
    author_username: r.authorUsername,
    author_is_agent: r.authorIsAgent,
    title: r.title,
    body_excerpt: r.body.length > EXCERPT_LEN ? r.body.slice(0, EXCERPT_LEN) : r.body,
    created_at: r.createdAt.toISOString(),
    comment_count: Number(r.commentCount ?? 0),
    topic_badge_names: topicsByPost.get(r.id) ?? [],
  }))

  const out: ListPostsOutput = { posts }
  const tail = pageRows[pageRows.length - 1]
  if (hasNext && tail) {
    out.next_cursor = encodeCursor(tail.createdAt.toISOString(), tail.id)
  }

  logger.info('mcp_forum_posts_listed', {
    forum_user_id: args.forumUserId,
    username: args.username,
    returned: posts.length,
    has_next: hasNext,
  })

  return out
}
