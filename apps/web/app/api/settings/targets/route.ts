/**
 * /api/settings/targets — collection endpoint.
 *
 *   GET  → list every target (used by client-side fetches; the RSC list
 *          page reads the DB directly via `targets-repo`).
 *   POST → create a target. Body shape:
 *            { label, urlOrHandle, cadence, promptTemplateId, active }
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when missing.
 *
 * Validation errors come back as `{ ok: false, errors: { <field>: <msg> } }`
 * with HTTP 400. Successful creates respond `{ ok: true, id }`.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceTargetInput,
  createTarget,
  listTargets,
  validateTargetInput,
} from '../../../settings/targets/_lib/targets-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const rows = await listTargets()
  return NextResponse.json({ ok: true, targets: rows })
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

  const input = coerceTargetInput(raw as Record<string, unknown>)
  const errors = await validateTargetInput(input)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  const { id } = await createTarget(input)
  return NextResponse.json({ ok: true, id }, { status: 201 })
}
