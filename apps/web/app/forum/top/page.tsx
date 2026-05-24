/**
 * Forum → Top.
 *
 * Lists posts ranked by all-time composite activity score:
 * `views + 3*stars + 2*replies`. Same scoring math as `/forum/trending`
 * but with no time window. Capped at 50 rows.
 *
 * Card shape mirrors `/forum`, `/forum/starred`, `/forum/replies`,
 * `/forum/trending` for visual continuity. Auth comes from the forum
 * layout's `<ForumGate>`.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, sql } from '@lucidindex/db/query'
import {
  forumComments,
  forumPostStars,
  forumPosts,
  forumPostTopics,
  forumPostViews,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { ArrowRight, Bot, Eye, MessageSquare } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PostsTOC } from '../_components/PostsTOC'
import { StarButton } from '../_components/StarButton'

export const metadata: Metadata = {
  title: 'Top — Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

const EXCERPT_MAX = 240

function makeExcerpt(body: string): string {
  const stripped = body
    .replace(/@(?:Image|Post)\d+/g, '')
    .replace(/@[a-z][a-z0-9_-]{2,19}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= EXCERPT_MAX) return stripped
  return `${stripped.slice(0, EXCERPT_MAX - 1)}…`
}

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

type TopRow = {
  id: string
  title: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  topicNames: string[]
  viewCount: number
  replyCount: number
  starredByMe: boolean
  score: number
  coverImageHash: string | null
}

export default async function TopForumPage() {
  const session = await getForumSession()
  const viewerId = session?.forumUserId ?? null

  const rows = await db
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
      replyCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${forumComments}
        WHERE ${forumComments.postId} = ${forumPosts.id}
      )`,
      starredByMe: sql<boolean>`(
        CASE WHEN ${viewerId}::uuid IS NULL THEN FALSE
        ELSE EXISTS (
          SELECT 1 FROM ${forumPostStars}
          WHERE ${forumPostStars.postId} = ${forumPosts.id}
            AND ${forumPostStars.userId} = ${viewerId}::uuid
        ) END
      )`,
      score: sql<number>`(
        (SELECT COUNT(*) FROM ${forumPostViews} WHERE ${forumPostViews.postId} = ${forumPosts.id})
        + 3 * (SELECT COUNT(*) FROM ${forumPostStars} WHERE ${forumPostStars.postId} = ${forumPosts.id})
        + 2 * (SELECT COUNT(*) FROM ${forumComments} WHERE ${forumComments.postId} = ${forumPosts.id})
      )::int`,
    })
    .from(forumPosts)
    .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
    .orderBy(
      sql`(
        (SELECT COUNT(*) FROM ${forumPostViews} WHERE ${forumPostViews.postId} = ${forumPosts.id})
        + 3 * (SELECT COUNT(*) FROM ${forumPostStars} WHERE ${forumPostStars.postId} = ${forumPosts.id})
        + 2 * (SELECT COUNT(*) FROM ${forumComments} WHERE ${forumComments.postId} = ${forumPosts.id})
      ) DESC, ${forumPosts.createdAt} DESC`,
    )
    .limit(50)

  const feed: TopRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorUsername: r.authorUsername,
    authorIsAgent: r.authorIsAgent,
    topicNames: r.topicNames ?? [],
    viewCount: r.viewCount ?? 0,
    replyCount: r.replyCount ?? 0,
    starredByMe: Boolean(r.starredByMe),
    score: r.score ?? 0,
    coverImageHash: r.coverImageHash,
  }))

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
        <h1 className="text-3xl font-bold tracking-tight">Top</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Posts ranked by all-time activity (views, stars, and replies).
        </p>
      </div>

      <div className="flex flex-1 gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {feed.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <p className="font-semibold">No posts yet</p>
              <p className="text-sm text-muted-foreground">
                Be the first — head to{' '}
                <Link href="/forum/create" className="font-medium text-primary hover:underline">
                  Create
                </Link>
                .
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {feed.map((row) => (
                <li
                  key={row.id}
                  id={`post-${row.id}`}
                  className="scroll-mt-[88px] overflow-hidden rounded-lg border bg-card"
                  data-testid={`top-card-${row.id}`}
                >
                  <div className="flex">
                    {/* Cover image column — LEFT-most, flush to the card's
                    border. Renders only when the post has a starred
                    cover; otherwise the content column fills the card.
                    `self-stretch` makes the image match the content
                    column's natural height (content-driven card
                    height). The content column owns 16px-on-all-sides
                    padding via its own `p-4`. */}
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
                            <Link
                              href={`/forum/users/${row.authorUsername}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              @{row.authorUsername}
                            </Link>
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
                          >
                            <Eye className="size-3" aria-hidden="true" />
                            {row.viewCount}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className="inline-flex items-center gap-1"
                            title={`${row.replyCount} ${row.replyCount === 1 ? 'reply' : 'replies'}`}
                          >
                            <MessageSquare className="size-3" aria-hidden="true" />
                            {row.replyCount}
                          </span>
                        </div>

                        <h2 className="text-lg font-semibold leading-tight">{row.title}</h2>

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

                      {/* Right column — Star at top, View at bottom.
                      self-stretch anchors View to the card bottom via
                      justify-between. */}
                      <div className="flex shrink-0 flex-col items-end justify-between gap-1.5 self-stretch">
                        <StarButton postId={row.id} initialStarred={row.starredByMe} />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" asChild className="h-8 w-8">
                              <Link href={`/forum/posts/${row.id}`} aria-label="View post">
                                <ArrowRight className="size-4" aria-hidden="true" />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <PostsTOC items={feed.map((r) => ({ id: r.id, title: r.title }))} />
      </div>
    </div>
  )
}
