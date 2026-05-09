/**
 * /api/settings/forum-invites — admin-gated collection endpoint.
 *
 *   GET  → list all invites (hashes + metadata only).
 *   POST → generate a new invite. Body: { label: string, expiresAt?: string|null }
 *          On success: { ok: true, code: string, row }
 *          The cleartext `code` is returned EXACTLY ONCE here. Client must
 *          display it with a "save now" warning.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when session is missing.
 */

import { DEV_BYPASS_ADMIN_ID, requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  issueForumInvite,
  LABEL_MAX,
  listForumInvites,
} from '../../../settings/forum-invites/_lib/forum-invites-repo'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const invites = await listForumInvites()
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
  const body = raw as { label?: unknown }

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

  const sessionAdminId = session.adminId as string | undefined
  if (!sessionAdminId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // Under LUCIDINDEX_DEV_SKIP_AUTH the session.adminId is a synthetic
  // sentinel with no row in the admins table. Persist null so the FK
  // doesn't reject the insert; the audit field re-attaches on a real
  // admin claim.
  const adminId: string | null = sessionAdminId === DEV_BYPASS_ADMIN_ID ? null : sessionAdminId

  const result = await issueForumInvite({ label, adminId })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, code: result.code, row: result.row }, { status: 201 })
}
