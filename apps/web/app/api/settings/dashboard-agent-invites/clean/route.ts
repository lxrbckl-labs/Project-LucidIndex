/**
 * POST /api/settings/dashboard-agent-invites/clean
 *
 * Bulk-delete every inactive dashboard-agent invite — redeemed,
 * revoked, or naturally expired. Admin-gated.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { cleanInactiveInvites } from '../../../../settings/dashboard-agent-invites/_lib/dashboard-agent-invites-repo'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const result = await cleanInactiveInvites()
  return NextResponse.json({ ok: true, deleted: result.deleted })
}
