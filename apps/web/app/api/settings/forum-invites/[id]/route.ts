/**
 * Single-invite endpoint.
 *
 *   POST /api/settings/forum-invites/:id  { action: 'revoke' | 'unrevoke' }
 *     → 'revoke':   stamp `revoked_at = now()`. Works on unredeemed AND
 *                   redeemed rows (revoke is the kill-switch on the
 *                   linked forum user's login). Idempotent.
 *     → 'unrevoke': clear `revoked_at` back to NULL — restores access.
 *                   Idempotent on already-active rows.
 *
 * Per the NO DELETIONS posture there is no DELETE endpoint — admins
 * revoke rather than remove.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  revokeForumInvite,
  unrevokeForumInvite,
} from '../../../../settings/forum-invites/_lib/forum-invites-repo'

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
  if (action !== 'revoke' && action !== 'unrevoke') {
    return NextResponse.json(
      { ok: false, error: "action must be 'revoke' or 'unrevoke'." },
      { status: 400 },
    )
  }

  if (action === 'revoke') {
    const result = await revokeForumInvite(id)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: 'Could not revoke.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, alreadyRevoked: result.alreadyRevoked })
  }

  const result = await unrevokeForumInvite(id)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: 'Could not restore.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, alreadyActive: result.alreadyActive })
}
