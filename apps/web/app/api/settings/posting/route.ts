/**
 * /api/settings/posting — admin-gated mutate endpoint for the four
 * configurable post limits on the `forum_settings` singleton.
 *
 *   POST → body { maxTopicsPerPost?, maxImagesPerPost?, maxTitleChars?,
 *                 maxBodyChars? } → UPSERTs the singleton row.
 *          Returns { ok: true, row } or 400 with { ok: false, error }.
 *
 * Auth: passkey-gated via `requireAdmin()` — same posture as sibling
 * admin routes (e.g. /api/settings/dashboard-agent-invites).
 *
 * Validation lives in `updatePostingSettings`; this route is a thin
 * translation layer from HTTP into the repo call.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  type UpdateInput,
  updatePostingSettings,
} from '../../../settings/posting/_lib/posting-repo'

export const dynamic = 'force-dynamic'

const FIELDS = ['maxTopicsPerPost', 'maxImagesPerPost', 'maxTitleChars', 'maxBodyChars'] as const

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
  const body = raw as Record<string, unknown>

  // Whitelist the four fields, leaving any extras out of the patch
  // so a stale client can't smuggle in keys we don't recognize.
  const patch: UpdateInput = {}
  for (const key of FIELDS) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'number') {
      return NextResponse.json({ ok: false, error: `${key} must be a number.` }, { status: 400 })
    }
    patch[key] = value
  }

  const result = await updatePostingSettings(patch)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, row: result.row })
}
