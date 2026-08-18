/**
 * /api/settings/comparison-sources — collection endpoint.
 *
 *   GET  → list all comparison sources.
 *   POST → create a comparison source.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when missing.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceComparisonSourceInput,
  createComparisonSource,
  listComparisonSources,
  validateComparisonSourceInput,
} from '../../../settings/comparison-sources/_lib/comparison-sources-repo'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const sources = await listComparisonSources()
  return NextResponse.json({ ok: true, sources })
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
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

  const { id } = await createComparisonSource(input)
  return NextResponse.json({ ok: true, id }, { status: 201 })
}
