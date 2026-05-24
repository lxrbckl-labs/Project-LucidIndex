/**
 * /api/agent-invites/forum/[id] — single-resource endpoint for the
 * forum agent TOKEN (NOT the invite — that lives at
 * /api/settings/agent-invites/[id]).
 *
 *   POST { action: "revoke" } → set revoked_at = now() on the
 *        `forum_agent_tokens` row identified by `[id]`. Idempotent —
 *        revoking an already-revoked token is a no-op (200).
 *        Returns 404 if the token id doesn't exist.
 *
 * Why this lives under /api/agent-invites/forum/ and not
 * /api/settings/agent-tokens/forum/: the forum side intentionally
 * exposes a single admin surface — Settings → Agents (which renders
 * the invites panel). Each row already knows its `redeemedTokenId`,
 * so the most natural revoke entry-point is keyed off the same
 * URL family the panel already uses.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when session is
 * missing — matches the dashboard token-revoke pattern at
 * /api/settings/agent-tokens/[id]/route.ts.
 *
 * Revoke fires a NOTIFY on the `forum_agent_token_revoked` channel;
 * the mcp-forum sidecar's LISTEN subscription evicts the matching
 * verify-cache entry within the round-trip (~10ms). If the listener
 * is dead (rare; see token-revocation-listener.ts), the 60s cache
 * TTL is the safety net — revoke still takes effect, just up to 60s
 * later.
 *
 * NO DELETE — revocation is the only end-of-life action. Rows stay
 * in the DB for audit purposes per the NO DELETIONS hard rule.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { revokeForumAgentToken } from '../../../../settings/agent-invites/_lib/agent-invites-repo'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid token id.' }, { status: 400 })
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

  const result = await revokeForumAgentToken(id)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ ok: false, error: 'Token not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: 'Could not revoke.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, alreadyRevoked: result.alreadyRevoked })
}
