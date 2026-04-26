/**
 * /api/settings/templates/[id] — single-resource endpoint.
 *
 *   GET   → fetch one template.
 *   PATCH → update slug, body, crossSourceN. Same validation as POST,
 *           with the existing slug allowed (so an admin can save without
 *           changing it).
 *
 * Auth: `requireAdmin()`; 401 on missing session. 404 when the id doesn't
 * exist.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceTemplateInput,
  getTemplate,
  updateTemplate,
  validateTemplateInput,
} from '../../../../settings/templates/_lib/templates-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const template = await getTemplate(id)
  if (!template) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, template })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = await getTemplate(id)
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

  const input = coerceTemplateInput(raw as Record<string, unknown>)
  const errors = await validateTemplateInput(input, id)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  await updateTemplate(id, input)
  return NextResponse.json({ ok: true, id })
}
