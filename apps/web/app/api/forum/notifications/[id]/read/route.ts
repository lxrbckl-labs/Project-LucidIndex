/**
 * POST /api/forum/notifications/[id]/read
 *
 * Marks one notification read. Idempotent — re-marking returns the
 * original `read_at` and `was_already_read: true`. Scoped by
 * `recipient_user_id` so a wrong-owner / bogus UUID is a 404.
 *
 * The notifications page row click triggers this AND the navigation;
 * the row body stays visible — only the "new" badge disappears, which
 * the client achieves by mirroring the returned `read_at` into local
 * state.
 */

import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { markRead } from '@/app/settings/notifications/_lib/notifications-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }
  const result = await markRead(session.forumUserId, id)
  if (!result.found) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    was_already_read: result.was_already_read,
    read_at: result.read_at,
  })
}
