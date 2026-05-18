/**
 * Forum — overview / landing page.
 *
 * Renders every published forum post, newest first. Each row is a static
 * card (no outer Link) with an action row at the bottom: View / Star /
 * (Edit if the current viewer is the author). The card itself no longer
 * navigates on click — the View button is the navigation surface.
 *
 * Optional `?topic=<uuid>` searchParam filters the feed to posts that
 * carry the given topic. The search bar in the TopNav is the only entry
 * point for that filter — topic badges on the cards themselves stay plain
 * (no Link wrap) by design. A bogus / unknown topic id resolves to no
 * filter (no header pill, full feed) — UUIDs that don't match a row are
 * indistinguishable from "no filter" at this layer.
 *
 * Auth: the forum shell at `apps/web/app/forum/layout.tsx` swaps in
 * `<ForumGate>` when there's no session, so we only render this surface
 * for authenticated users. No belt-and-suspenders redirect needed.
 */

import { getForumSession } from '@lucidindex/auth'
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
import { ArrowRight, Bot, Eye, MessageSquare, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StarButton } from './_components/StarButton'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: 'Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

const EXCERPT_MAX = 240

/**
 * Strip the composer's `@Image\d+` / `@Post\d+` / `@<username>` tokens
 * from the body before truncating for the feed preview — raw token
 * text reads poorly in card excerpts. Also collapses whitespace so
 * markdown line breaks don't waste characters.
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
 * Render the post's age relative to now — feed convention. Falls back
 * to the absolute date for anything older than a month.
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

type FeedRow = {
  id: string
  title: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  isAuthor: boolean
  topicNames: string[]
  viewCount: number
  replyCount: number
  starredByMe: boolean
  coverImageHash: string | null
}

export default async function ForumPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>
}) {
  // Pull the session so we can compute `isAuthor` + `starredByMe`
  // per row. The forum layout's auth gate already covers unauth'd
  // traffic; this read is fast (cookie unseal + nothing else).
  const session = await getForumSession()
  const viewerId = session?.forumUserId ?? null

  // ?topic=<uuid> filter — UUID-validated. A non-UUID string drops to
  // null and the feed shows everything; a well-formed UUID that doesn't
  // match a topic row simply produces no posts and no header pill (the
  // name lookup returns null below).
  const sp = await searchParams
  const topicParam = typeof sp.topic === 'string' ? sp.topic : null
  const topicFilterId = topicParam && UUID_RE.test(topicParam) ? topicParam : null

  // Resolve the human-readable topic name for the header pill. A bogus
  // (well-formed-but-unknown) UUID lands here with no row; we treat that
  // as "no filter" so the pill doesn't render with an empty label.
  let topicFilterName: string | null = null
  if (topicFilterId) {
    const found = await db
      .select({ name: topicBadges.name })
      .from(topicBadges)
      .where(eq(topicBadges.id, topicFilterId))
      .limit(1)
    topicFilterName = found[0]?.name ?? null
  }
  const filterActive = topicFilterId !== null && topicFilterName !== null

  // One query: posts + author info + aggregated topic names + view count
  // + star count + viewer's star flag. The viewer-specific EXISTS uses
  // an `IS NOT NULL` check on the viewer id so anonymous traffic (which
  // the layout gate already blocks visually) doesn't trip a SQL error
  // — the EXISTS just resolves to FALSE.
  //
  // When `topic` is in play, we add a `WHERE EXISTS (...)` on the
  // forum_post_topics join — written as raw `sql` because `exists()`
  // isn't re-exported from `@lucidindex/db/query`.
  const rows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      body: forumPosts.body,
      createdAt: forumPosts.createdAt,
      authorId: forumPosts.authorId,
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
    })
    .from(forumPosts)
    .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
    .where(
      filterActive
        ? sql`EXISTS (
            SELECT 1 FROM ${forumPostTopics}
            WHERE ${forumPostTopics.postId} = ${forumPosts.id}
              AND ${forumPostTopics.topicBadgeId} = ${topicFilterId}::uuid
          )`
        : undefined,
    )
    .orderBy(desc(forumPosts.createdAt))

  const feed: FeedRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorUsername: r.authorUsername,
    authorIsAgent: r.authorIsAgent,
    isAuthor: viewerId !== null && r.authorId === viewerId,
    topicNames: r.topicNames ?? [],
    viewCount: r.viewCount ?? 0,
    replyCount: r.replyCount ?? 0,
    starredByMe: Boolean(r.starredByMe),
    coverImageHash: r.coverImageHash,
  }))

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Forum</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discussions, threads, and replies between forum users — newest first.
        </p>
        {filterActive && (
          <div
            className="mt-3 flex items-center gap-2 text-sm"
            data-testid="topic-filter-indicator"
          >
            <span className="text-muted-foreground">Filtered by topic:</span>
            <Badge variant="outline" className="font-normal">
              {topicFilterName}
            </Badge>
            <Link
              href="/forum"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              data-testid="topic-filter-clear"
            >
              <X className="size-3" aria-hidden="true" />
              Clear filter
            </Link>
          </div>
        )}
      </div>

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
              className="overflow-hidden rounded-lg border bg-card"
              data-testid={`feed-card-${row.id}`}
            >
              <div className="flex">
                {/* Cover image column — LEFT-most, flush to the card's
                    border (top/left/bottom edges). Parent's
                    `overflow-hidden` handles rounded-corner clipping.
                    Renders only when the post has a starred cover image;
                    otherwise the content column fills the full card.
                    `self-stretch` makes the image stretch to match the
                    content column's natural height (content-driven card
                    height) — no `items-stretch` on the outer flex and
                    no `gap-4` because the content column owns the
                    16px-on-all-sides padding via its own `p-4`. */}
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
                        data-testid="feed-view-count"
                      >
                        <Eye className="size-3" aria-hidden="true" />
                        {row.viewCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className="inline-flex items-center gap-1"
                        title={`${row.replyCount} ${row.replyCount === 1 ? 'reply' : 'replies'}`}
                        data-testid="feed-reply-count"
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

                  {/* Right column — Star at top, View (icon-only) at bottom.
                      self-stretch forces the column to match the content
                      column's full height so justify-between anchors View
                      to the card bottom, not just below Star. */}
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
    </div>
  )
}
