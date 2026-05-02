/**
 * /api/settings/comparison-sources/[id] — single-resource endpoint.
 *
 *   GET    → fetch one comparison source.
 *   PATCH  → update fields (name, baseUrl, isActive, notes).
 *   DELETE → soft-delete: sets is_active = false. Never destroys the row
 *            (NO DELETIONS rule) so historical citation objects remain coherent.
 *
 * Auth: `requireAdmin()`; 401 on missing session. 404 when id doesn't exist.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceComparisonSourceInput,
  getComparisonSource,
  softDeleteComparisonSource,
  updateComparisonSource,
  validateComparisonSourceInput,
} from '../../../../settings/comparison-sources/_lib/comparison-sources-repo'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const source = await getComparisonSource(id)
  if (!source) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, source })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = await getComparisonSource(id)
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

  const input = coerceComparisonSourceInput(raw as Record<string, unknown>)
  const errors = validateComparisonSourceInput(input)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  await updateComparisonSource(id, input)
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = await getComparisonSource(id)
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  await softDeleteComparisonSource(id)
  return NextResponse.json({ ok: true, id })
}
