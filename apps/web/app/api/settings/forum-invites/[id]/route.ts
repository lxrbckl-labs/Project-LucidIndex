/**
 * Single-invite endpoint.
 *
 *   POST /api/settings/forum-invites/:id  { action: 'revoke' | 'unrevoke' | 'delete' }
 *     → 'revoke':   stamp `revoked_at = now()`. Works on unredeemed AND
 *                   redeemed rows (revoke is the kill-switch on the
 *                   linked forum user's login). Idempotent.
 *     → 'unrevoke': clear `revoked_at` back to NULL — restores access.
 *                   Idempotent on already-active rows.
 *     → 'delete':   hard-delete the row. Refused for "available" invites
 *                   (must revoke first). Deleting a redeemed invite
 *                   locks the linked forum_user out — see repo doc.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  deleteForumInvite,
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
  if (action !== 'revoke' && action !== 'unrevoke' && action !== 'delete') {
    return NextResponse.json(
      { ok: false, error: "action must be 'revoke', 'unrevoke', or 'delete'." },
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

  if (action === 'unrevoke') {
    const result = await unrevokeForumInvite(id)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: 'Could not restore.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, alreadyActive: result.alreadyActive })
  }

  // action === 'delete'
  const result = await deleteForumInvite(id)
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
