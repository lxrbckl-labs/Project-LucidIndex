/**
 * Forum → User Profile.
 *
 * Surfaces a forum user's activity:
 *   - Header band: avatar, @username, agent badge (if applicable), and
 *     a muted secondary line of post-count · comment-count · join date.
 *   - Top topics: up to 5 topic badges aggregated across both posts the
 *     user authored AND posts they commented on, ordered by total
 *     appearance count. Section is omitted entirely for users with
 *     zero authored posts AND zero comments.
 *   - Recent posts: every post the user authored, newest first, using
 *     the same card layout as the `/forum` feed. No pagination — the
 *     fixture sizes fit on one scroll, same posture as the feed.
 *
 * Username is the URL key (uniqueness + CHECK regex enforced at the
 * `forum_users` table). A missing row → notFound(). Auth is delegated
 * to the parent `apps/web/app/forum/layout.tsx`, which swaps in the
 * `<ForumGate>` overlay for unauthenticated traffic — no redundant
 * redirect needed here.
 *
 * The four DB round-trips (user lookup, author/comment counts, top
 * topics, recent posts) run in parallel via `Promise.all`. The top-5
 * topics aggregation is a single hand-written SQL statement (UNION ALL
 * + GROUP BY) — clearer expressed inline than threading through
 * Drizzle's query builder. The recent-posts query mirrors the feed's
 * correlated-subquery pattern for topic arrays so the card render is
 * uniform across surfaces.
 */

import { getForumSession, requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import {
  forumComments,
  forumPostStars,
  forumPosts,
  forumPostTopics,
  forumPostViews,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { ArrowRight, Bot, Eye } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StarButton } from '../../_components/StarButton'

export const dynamic = 'force-dynamic'

const EXCERPT_MAX = 240

/**
 * Strip the composer's `@Image\d+` / `@Post\d+` / `@<username>` tokens
 * from the body before truncating for the feed preview — raw token
 * text reads poorly in card excerpts. Inline-duplicated from
 * `apps/web/app/forum/page.tsx` so the profile card render is
 * pixel-identical to the feed card render. If a third surface lands
 * with the same need, pull this into `_lib/feed-card.ts` then.
 */
function makeExcerpt(body: string): string {
  const stripped = body
    .replace(/@(?:Image|Post)\d+/g, '')
    .replace(/@[a-z][a-z0-9_-]{2,19}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= EXCERPT_MAX) return stripped
  return `${stripped.slice(0, EXCERPT_MAX - 1)}…`
}

/**
 * Render a timestamp relative to now — feed convention. Falls back to
 * the absolute date for anything older than a month. Inline-duplicated
 * from `apps/web/app/forum/page.tsx` (see `makeExcerpt` note).
 */
function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

/**
 * "Joined" date used in the header subline. Short, absolute — relative
 * is helpful for "what changed lately" but profile join dates are
 * better as anchors.
 */
function formatJoined(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

type PageProps = {
  params: Promise<{ username: string }>
}

type FeedRow = {
  id: string
  title: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  topicNames: string[]
  viewCount: number
  starredByMe: boolean
  isAuthor: boolean
  coverImageHash: string | null
}

type TopTopicRow = {
  topic_id: string
  topic_name: string
  count: number
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params
  return { title: `@${username} — Forum — LucidIndex` }
}

export default async function UserProfilePage({ params }: PageProps) {
  // Auth — the forum layout's `<ForumGate>` already covers unauthed
  // traffic visually, but calling `requireForumUser` keeps the page
  // explicit about its session expectation and matches the rest of
  // the forum-page convention. We also need the session id to compute
  // `isAuthor` + `starredByMe` for each row.
  await requireForumUser()
  const session = await getForumSession()
  const viewerId = session?.forumUserId ?? null

  const { username } = await params

  // User lookup first — the other queries pivot on the resolved user
  // id, so they can't fan out until we have it. A missing row is the
  // 404 condition.
  const userRows = await db
    .select({
      id: forumUsers.id,
      username: forumUsers.username,
      isAgent: forumUsers.isAgent,
      createdAt: forumUsers.createdAt,
      hasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
    })
    .from(forumUsers)
    .where(eq(forumUsers.username, username))
    .limit(1)
  const user = userRows[0]
  if (!user) notFound()

  const userId = user.id

  // Fan out: counts, top topics, recent posts. None depend on each
  // other.
  const [postCountRows, commentCountRows, topTopicRows, recentRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPosts)
      .where(eq(forumPosts.authorId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumComments)
      .where(eq(forumComments.authorId, userId)),
    db.execute<TopTopicRow>(sql`
      SELECT
        tb.id::text   AS topic_id,
        tb.name       AS topic_name,
        COUNT(*)::int AS count
      FROM (
        SELECT fpt.topic_badge_id
        FROM ${forumPostTopics} fpt
        JOIN ${forumPosts} fp ON fp.id = fpt.post_id
        WHERE fp.author_id = ${userId}::uuid
        UNION ALL
        SELECT fpt.topic_badge_id
        FROM ${forumPostTopics} fpt
        JOIN ${forumComments} fc ON fc.post_id = fpt.post_id
        WHERE fc.author_id = ${userId}::uuid
      ) agg
      JOIN ${topicBadges} tb ON tb.id = agg.topic_badge_id
      GROUP BY tb.id, tb.name
      ORDER BY count DESC, tb.name ASC
      LIMIT 5
    `),
    db
      .select({
        id: forumPosts.id,
        title: forumPosts.title,
        body: forumPosts.body,
        createdAt: forumPosts.createdAt,
        authorUsername: forumUsers.username,
        authorIsAgent: forumUsers.isAgent,
        coverImageHash: forumPosts.coverImageHash,
        topicNames: sql<string[]>`COALESCE(
          (
            SELECT array_agg(${topicBadges.name} ORDER BY ${topicBadges.name})
            FROM ${forumPostTopics}
            JOIN ${topicBadges} ON ${topicBadges.id} = ${forumPostTopics.topicBadgeId}
            WHERE ${forumPostTopics.postId} = ${forumPosts.id}
          ),
          ARRAY[]::text[]
        )`,
        viewCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${forumPostViews}
          WHERE ${forumPostViews.postId} = ${forumPosts.id}
        )`,
        starredByMe: sql<boolean>`(
          CASE WHEN ${viewerId}::uuid IS NULL THEN FALSE
          ELSE EXISTS (
            SELECT 1 FROM ${forumPostStars}
            WHERE ${forumPostStars.postId} = ${forumPosts.id}
              AND ${forumPostStars.userId} = ${viewerId}::uuid
          ) END
        )`,
      })
      .from(forumPosts)
      .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
      .where(eq(forumPosts.authorId, userId))
      .orderBy(desc(forumPosts.createdAt)),
  ])

  const postCount = postCountRows[0]?.count ?? 0
  const commentCount = commentCountRows[0]?.count ?? 0

  // The profile's user is the author of every row here — `isAuthor`
  // reduces to "the viewer is looking at their own profile".
  const isOwnProfile = viewerId !== null && viewerId === userId

  const recent: FeedRow[] = recentRows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorUsername: r.authorUsername,
    authorIsAgent: r.authorIsAgent,
    topicNames: r.topicNames ?? [],
    viewCount: r.viewCount ?? 0,
    starredByMe: Boolean(r.starredByMe),
    isAuthor: isOwnProfile,
    coverImageHash: r.coverImageHash,
  }))

  const hasAnyActivity = postCount > 0 || commentCount > 0

  return (
    <div className="flex flex-col gap-8">
      {/* Header band — full-width sweep that matches the `/forum` feed's
          framing exactly (mirrored padding pulls back to the inset edge). */}
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <div className="flex items-center gap-4">
          <Avatar className="size-16 shrink-0">
            {user.hasAvatar ? (
              <AvatarImage src={`/api/forum/users/${user.username}/avatar`} alt="" />
            ) : null}
            <AvatarFallback className="text-sm">
              {user.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">@{user.username}</h1>
              {user.isAgent && (
                <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                  <Bot className="size-3" aria-hidden="true" />
                  agent
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {postCount} {postCount === 1 ? 'post' : 'posts'}
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              joined {formatJoined(user.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Top topics — only when the user has at least one post or comment.
          Otherwise the aggregation is empty and a labelled empty box reads
          worse than just dropping the section. */}
      {hasAnyActivity && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top topics
          </h2>
          {topTopicRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topTopicRows.map((t) => (
                <Badge key={t.topic_id} variant="outline" className="font-normal">
                  {t.topic_name}
                  <span className="ml-1.5 text-muted-foreground">({t.count})</span>
                </Badge>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recent posts — same card layout as the `/forum` feed. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent posts
        </h2>

        {recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
            <p className="font-semibold">No posts yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {recent.map((row) => (
              <li
                key={row.id}
                className="overflow-hidden rounded-lg border bg-card"
                data-testid={`profile-card-${row.id}`}
              >
                <div className="flex">
                  {/* Cover image column — LEFT-most, flush to the card's
                      border. Renders only when the post has a starred
                      cover; otherwise the content column fills the card.
                      Mirrors `/forum` feed exactly — `self-stretch`
                      makes the image match the content column's natural
                      height (content-driven card height); the content
                      column owns 16px-on-all-sides padding via its own
                      `p-4`. */}
                  {row.coverImageHash && (
                    <Link
                      href={`/forum/posts/${row.id}`}
                      className="block w-32 shrink-0 self-stretch bg-muted"
                      data-testid={`feed-cover-${row.id}`}
                      aria-label={`Open post: ${row.title}`}
                    >
                      {/* biome-ignore lint/performance/noImgElement: Route Handler serves bytes */}
                      <img
                        src={`/i/${row.coverImageHash}`}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover select-none"
                      />
                    </Link>
                  )}

                  <div className="flex min-w-0 flex-1 items-start justify-between gap-4 p-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AuthorHoverCard username={row.authorUsername}>
                          <span className="font-medium text-foreground">@{row.authorUsername}</span>
                        </AuthorHoverCard>
                        {row.authorIsAgent && (
                          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                            <Bot className="size-3" aria-hidden="true" />
                            agent
                          </Badge>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{relativeTime(row.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className="inline-flex items-center gap-1"
                          title={`${row.viewCount} ${row.viewCount === 1 ? 'view' : 'views'}`}
                          data-testid="profile-view-count"
                        >
                          <Eye className="size-3" aria-hidden="true" />
                          {row.viewCount}
                        </span>
                      </div>

                      <h3 className="text-lg font-semibold leading-tight">{row.title}</h3>

                      {row.body.length > 0 && (
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                          {makeExcerpt(row.body)}
                        </p>
                      )}

                      {row.topicNames.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.topicNames.map((name) => (
                            <Badge key={name} variant="outline" className="font-normal">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right column — Star at top, View (icon-only) at bottom.
                        Mirrors the /forum feed card layout. Edit lives on
                        the post view itself. self-stretch anchors View to
                        the card bottom via justify-between. */}
                    <div className="flex shrink-0 flex-col items-end justify-between gap-1.5 self-stretch">
                      <StarButton postId={row.id} initialStarred={row.starredByMe} />
                      <Button
                        variant="outline"
                        size="icon"
                        asChild
                        title="View"
                        className="h-8 w-8"
                        data-testid={`view-button-${row.id}`}
                      >
                        <Link href={`/forum/posts/${row.id}`} aria-label="View post">
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
