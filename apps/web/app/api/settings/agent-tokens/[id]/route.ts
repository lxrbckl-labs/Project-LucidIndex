/**
 * /api/settings/agent-tokens/[id] — single-resource endpoint.
 *
 *   POST { action: "revoke" } → set revoked_at = now() on the token.
 *        Idempotent — revoking an already-revoked token is a no-op (200).
 *        Returns 404 if the token id doesn't exist.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when session is missing.
 *
 * NO DELETE — revocation is the only end-of-life action. Rows stay in the
 * DB for audit purposes per the NO DELETIONS hard rule.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { revokeToken } from '../../../../settings/agent-tokens/_lib/agent-tokens-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
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

  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).action !== 'revoke') {
    return NextResponse.json(
      { ok: false, error: 'Expected { action: "revoke" } in request body.' },
      { status: 400 },
    )
  }

  const { id } = await ctx.params
  const found = await revokeToken(id)

  if (!found) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, id })
}
