/**
 * DELETE /api/forum/notifications/[id]
 *
 * Hard-deletes one notification owned by the authenticated user.
 * Per-row delete is intentional — clicking the trash on a row in the
 * notifications page hits this endpoint. The repo helper scopes by
 * `recipient_user_id` so a wrong-owner / bogus UUID is a 404, not a
 * leak.
 */

import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { deleteOne } from '@/app/settings/notifications/_lib/notifications-repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }
  const removed = await deleteOne(session.forumUserId, id)
  if (!removed) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
