/**
 * /api/settings/agent-invites — admin-gated collection endpoint (forum side).
 *
 *   GET  → list all forum-agent invites (hashes + metadata only).
 *   POST → mint a new invite. Body: { label: string, username: string }
 *          On success: { ok: true, code: string, row }
 *          The cleartext `code` is returned EXACTLY ONCE here.
 *
 * Auth: passkey-gated via `requireAdmin()`. Mirrors
 * `/api/settings/forum-invites/route.ts` + adds username validation
 * (the forum requires every actor — agent or human — to have a
 * `forum_users` identity with a unique handle).
 */

import { DEV_BYPASS_ADMIN_ID, requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  issueInvite,
  LABEL_MAX,
  listInvites,
  validateUsername,
} from '../../../settings/agent-invites/_lib/agent-invites-repo'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const invites = await listInvites()
  return NextResponse.json({ ok: true, invites })
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be valid JSON.' },
      { status: 400 },
    )
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'Request body must be a JSON object.' },
      { status: 400 },
    )
  }
  const body = raw as { label?: unknown; username?: unknown }

  if (typeof body.label !== 'string') {
    return NextResponse.json({ ok: false, error: 'Label is required.' }, { status: 400 })
  }
  const label = body.label.trim()
  if (!label) {
    return NextResponse.json({ ok: false, error: 'Label is required.' }, { status: 400 })
  }
  if (label.length > LABEL_MAX) {
    return NextResponse.json(
      { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer.` },
      { status: 400 },
    )
  }

  // validateUsername handles shape + uniqueness pre-check; the
  // redemption transaction's UNIQUE on forum_users.username is the
  // final guard against races.
  const usernameError = await validateUsername(body.username)
  if (usernameError) {
    const status = usernameError === 'Username already in use.' ? 409 : 400
    return NextResponse.json({ ok: false, error: usernameError }, { status })
  }
  const username = (body.username as string).trim()

  const sessionAdminId = session.adminId as string | undefined
  if (!sessionAdminId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const adminId: string | null = sessionAdminId === DEV_BYPASS_ADMIN_ID ? null : sessionAdminId

  const result = await issueInvite({ label, username, adminId })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, code: result.code, row: result.row }, { status: 201 })
}
