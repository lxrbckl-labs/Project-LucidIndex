/**
 * POST /api/settings/forum-invites/clean
 *
 * Bulk-delete every inactive invite in one shot — redeemed, revoked, or
 * naturally expired. Admin-gated. Returns the number of rows actually
 * removed so the client can show a precise toast.
 *
 * Caveat: redeemed invites swept up here remove the kill-switch anchor
 * `finishForumLogin` checks, so the linked forum_users lose login on
 * next attempt. The UI confirm dialog has to warn the admin before
 * firing this endpoint.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { cleanInactiveForumInvites } from '../../../../settings/forum-invites/_lib/forum-invites-repo'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const result = await cleanInactiveForumInvites()
  return NextResponse.json({ ok: true, deleted: result.deleted })
}
