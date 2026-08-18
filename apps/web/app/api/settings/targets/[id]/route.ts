/**
 * /api/settings/targets/[id] — single-resource endpoint.
 *
 *   GET   → fetch one target.
 *   PATCH → update human-supplied fields (label, urlOrHandle, cadence,
 *           promptTemplateId, active). Cron-managed fields are read-only
 *           here — the cron sidecar (Phase 4) and mcp-dashboard (Phase 3)
 *           own those.
 *
 * Pause/resume (toggle `active`) lives at `./[id]/active/route.ts`.
 *
 * Auth: `requireAdmin()`; 401 on missing session. 404 when the target
 * id doesn't exist.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceTargetInput,
  getTarget,
  updateTarget,
  validateTargetInput,
} from '../../../../settings/targets/_lib/targets-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const target = await getTarget(id)
  if (!target) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, target })
}

export async function PATCH(req: Request, ctx: RouteContext) {
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
    return NextResponse.json(
      { ok: false, errors: { _form: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json(
      { ok: false, errors: { _form: 'Request body must be a JSON object.' } },
      { status: 400 },
    )
  }

  const input = coerceTargetInput(raw as Record<string, unknown>)
  const errors = await validateTargetInput(input)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  await updateTarget(id, input)
  return NextResponse.json({ ok: true, id })
}
