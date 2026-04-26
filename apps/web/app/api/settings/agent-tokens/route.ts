/**
 * /api/settings/agent-tokens — collection endpoint.
 *
 *   GET  → list all tokens (no cleartexts, never returned more than once
 *          at issue time; this list only has hashes + metadata).
 *   POST → issue a new token. Body: { label: string }
 *          On success: { ok: true, token: string, row: AgentTokenRow }
 *          The cleartext `token` is returned EXACTLY ONCE here and never
 *          stored. The client MUST display it with a "save now" warning.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when session is missing.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  issueToken,
  listTokens,
  validateIssueInput,
} from '../../../settings/agent-tokens/_lib/agent-tokens-repo'

// Session-gated + DB-backed — request-scoped, must never be statically
// rendered at build time (no cookie store, no DB connection in the build
// container).
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const tokens = await listTokens()
  return NextResponse.json({ ok: true, tokens })
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

  const validationError = validateIssueInput(raw as Record<string, unknown>)
  if (validationError) {
    return NextResponse.json({ ok: false, error: validationError }, { status: 400 })
  }

  const label = (raw as Record<string, unknown>).label as string

  const result = await issueToken(label.trim())
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  // Cleartext token returned exactly once. Client must display + copy it
  // immediately — it will not be retrievable again.
  return NextResponse.json({ ok: true, token: result.token, row: result.row }, { status: 201 })
}
