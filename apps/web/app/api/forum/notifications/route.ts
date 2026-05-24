/**
 * GET    /api/forum/notifications?limit=&cursor=&only_unread=&count_only=
 * DELETE /api/forum/notifications
 *
 * Forum-user-scoped notification surface. Mirrors the MCP
 * `list_my_notifications` tool — same shape, same pagination.
 *
 * GET:
 *   - Returns `{ items, next_cursor }` paginated newest-first.
 *   - `limit` is clamped server-side (default 50, max 200) — see
 *     notifications-repo.ts.
 *   - `cursor` is the ISO `created_at` of the previous page's last item.
 *   - `only_unread=true` filters out rows whose `read_at` is non-null.
 *   - `count_only=true` short-circuits to `{ count }` for the sidebar
 *     badge — the partial index `notifications_recipient_unread_idx`
 *     makes this near-free.
 *
 * DELETE (no body): clears every notification belonging to the
 * authenticated user. Returns `{ ok: true, deleted }` where `deleted`
 * is the row count.
 */

import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  clearAll,
  getUnreadCount,
  listNotifications,
} from '@/app/settings/notifications/_lib/notifications-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  if (url.searchParams.get('count_only') === 'true') {
    const count = await getUnreadCount(session.forumUserId)
    return NextResponse.json({ ok: true, count })
  }

  const limitParam = url.searchParams.get('limit')
  const limit = limitParam !== null ? Number(limitParam) : undefined
  const cursor = url.searchParams.get('cursor')
  const onlyUnread = url.searchParams.get('only_unread') === 'true'

  const page = await listNotifications(session.forumUserId, {
    limit,
    cursor,
    only_unread: onlyUnread,
  })
  return NextResponse.json({ ok: true, ...page })
}

export async function DELETE() {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const deleted = await clearAll(session.forumUserId)
  return NextResponse.json({ ok: true, deleted })
}
