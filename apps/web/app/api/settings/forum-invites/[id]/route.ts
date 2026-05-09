/**
 * Single-invite endpoint.
 *
 *   POST /api/settings/forum-invites/:id  { action: 'revoke' }
 *     → mark an unredeemed invite as revoked. Idempotent — re-revoking a
 *       revoked row is fine. Already-redeemed rows are refused (redemption
 *       is the stronger terminal state).
 *
 * Per the NO DELETIONS posture there is no DELETE endpoint — admins
 * revoke rather than remove.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { revokeForumInvite } from '../../../../settings/forum-invites/_lib/forum-invites-repo'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid invite id.' }, { status: 400 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }
  const action = (raw as { action?: unknown } | null)?.action
  if (action !== 'revoke') {
    return NextResponse.json({ ok: false, error: "action must be 'revoke'." }, { status: 400 })
  }

  const result = await revokeForumInvite(id)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
    }
    if (result.reason === 'already_redeemed') {
      return NextResponse.json(
        { ok: false, error: 'Invite has already been redeemed and cannot be revoked.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: 'Could not revoke.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, alreadyRevoked: result.alreadyRevoked })
}
