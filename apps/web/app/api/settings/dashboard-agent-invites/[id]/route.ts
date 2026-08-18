/**
 * Single dashboard-agent-invite endpoint.
 *
 *   POST /api/settings/dashboard-agent-invites/:id  { action: 'revoke' | 'unrevoke' | 'delete' }
 *     → 'revoke':   stamp `revoked_at = now()`. Idempotent.
 *     → 'unrevoke': clear `revoked_at` back to NULL.
 *     → 'delete':   hard-delete the row. Refused for "available"
 *                   invites (must revoke first).
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  deleteInvite,
  revokeInvite,
  unrevokeInvite,
} from '../../../../settings/dashboard-agent-invites/_lib/dashboard-agent-invites-repo'

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
  if (action !== 'revoke' && action !== 'unrevoke' && action !== 'delete') {
    return NextResponse.json(
      { ok: false, error: "action must be 'revoke', 'unrevoke', or 'delete'." },
      { status: 400 },
    )
  }

  if (action === 'revoke') {
    const result = await revokeInvite(id)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: 'Could not revoke.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, alreadyRevoked: result.alreadyRevoked })
  }

  if (action === 'unrevoke') {
    const result = await unrevokeInvite(id)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: 'Could not restore.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, alreadyActive: result.alreadyActive })
  }

  // action === 'delete'
  const result = await deleteInvite(id)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
    }
    if (result.reason === 'still_active') {
      return NextResponse.json(
        { ok: false, error: 'Active invites must be revoked before they can be deleted.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: 'Could not delete.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
