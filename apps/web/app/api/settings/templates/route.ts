/**
 * /api/settings/templates — collection endpoint.
 *
 *   GET  → list every template (used by client-side fetches; the RSC list
 *          page reads the DB directly via `templates-repo`).
 *   POST → create a template. Body shape:
 *            { slug, body, crossSourceN }
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when missing.
 *
 * Validation errors come back as `{ ok: false, errors: { <field>: <msg> } }`
 * with HTTP 400. Successful creates respond `{ ok: true, id }` with 201.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  coerceTemplateInput,
  createTemplate,
  listTemplates,
  validateTemplateInput,
} from '../../../settings/templates/_lib/templates-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const rows = await listTemplates()
  return NextResponse.json({ ok: true, templates: rows })
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

  const input = coerceTemplateInput(raw as Record<string, unknown>)
  const errors = await validateTemplateInput(input)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  const { id } = await createTemplate(input)
  return NextResponse.json({ ok: true, id }, { status: 201 })
}
