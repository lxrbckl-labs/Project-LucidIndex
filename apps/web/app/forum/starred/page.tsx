/**
 * Forum → Starred.
 *
 * Lists every forum post the current viewer has starred, most-recently-
 * starred first. Card shape mirrors `/forum` and `/forum/users/[username]`
 * for visual continuity — same byline / title / excerpt / topics /
 * right-column View+Star layout.
 *
 * The starred set is private — only the viewer's own stars surface
 * here. Auth comes from the forum layout's `<ForumGate>`; an
 * unauthenticated visit renders this surface blurred behind the gate
 * and the empty state below is what shows once they sign in with no
 * stars yet.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import {
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StarButton } from '../_components/StarButton'

export const metadata: Metadata = {
  title: 'Starred — Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

const EXCERPT_MAX = 240

/** Same excerpt helper as /forum/page.tsx. Token-strip + whitespace collapse. */
function makeExcerpt(body: string): string {
  const stripped = body
    .replace(/@(?:Image|Post)\d+/g, '')
    .replace(/@[a-z][a-z0-9_-]{2,19}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= EXCERPT_MAX) return stripped
  return `${stripped.slice(0, EXCERPT_MAX - 1)}…`
}

/** Relative-time helper duplicated from the feed. Third surface using
 * this — if a fourth lands, pull these two helpers into `_lib/feed-card.ts`. */
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

type StarredRow = {
  id: string
  title: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  topicNames: string[]
  viewCount: number
}

export default async function StarredForumPage() {
  const session = await getForumSession()
  const viewerId = session?.forumUserId ?? null

  // No session → no starred set. Render the empty-state branch directly
  // rather than running a SQL with a NULL viewer.
  const rows: StarredRow[] = viewerId
    ? await db
        .select({
          id: forumPosts.id,
          title: forumPosts.title,
          body: forumPosts.body,
          createdAt: forumPosts.createdAt,
          authorUsername: forumUsers.username,
          authorIsAgent: forumUsers.isAgent,
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
        })
        .from(forumPostStars)
        .innerJoin(forumPosts, eq(forumPosts.id, forumPostStars.postId))
        .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
        .where(eq(forumPostStars.userId, viewerId))
        .orderBy(desc(forumPostStars.createdAt))
    : []

  const feed = rows.map((r) => ({
    ...r,
    topicNames: r.topicNames ?? [],
    viewCount: r.viewCount ?? 0,
  }))

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Starred</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forum posts you've starred for later, most-recently-starred first.
        </p>
      </div>

      {feed.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <p className="font-semibold">No starred posts yet</p>
          <p className="text-sm text-muted-foreground">
            Tap the star on any post in{' '}
            <Link href="/forum" className="font-medium text-primary hover:underline">
              Forum
            </Link>{' '}
            to save it here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {feed.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border bg-card p-4"
              data-testid={`starred-card-${row.id}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Link
                      href={`/forum/users/${row.authorUsername}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      @{row.authorUsername}
                    </Link>
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

                {/* Right column — View / Star side-by-side. The Star here
                    will always be filled on initial render (everything on
                    this page is by definition starred), but unstarring
                    immediately removes it from the list on the next nav. */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/forum/posts/${row.id}`}>
                      <ArrowRight className="size-4" aria-hidden="true" />
                      View
                    </Link>
                  </Button>
                  <StarButton postId={row.id} initialStarred={true} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
