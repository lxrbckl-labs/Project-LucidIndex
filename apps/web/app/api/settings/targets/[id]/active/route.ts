/**
 * /api/settings/targets/[id]/active — pause/resume a target.
 *
 *   POST { active: boolean }  → set `targets.active`.
 *
 * Split into its own endpoint (rather than overloading PATCH on the
 * parent route with a partial body) so the list-page Pause/Resume button
 * can fire a single, intention-clear request without sending the rest of
 * the form fields.
 *
 * Auth: `requireAdmin()`; 401 on missing session.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { getTarget, setTargetActive } from '../../../../../settings/targets/_lib/targets-repo'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = await getTarget(id)
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof (raw as { active?: unknown }).active !== 'boolean'
  ) {
    return NextResponse.json({ ok: false, error: 'active_must_be_boolean' }, { status: 400 })
  }
  const active = (raw as { active: boolean }).active

  await setTargetActive(id, active)
  return NextResponse.json({ ok: true, id, active })
}
