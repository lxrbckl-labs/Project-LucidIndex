/**
 * POST /api/auth/founding/finish
 *
 * Verify the founding-admin WebAuthn attestation, persist the admin +
 * credential + hashed recovery code in one transaction, and return the
 * plaintext recovery code for one-time client display. Does NOT mint a
 * session — that's `/api/auth/founding/finalize` (handled by the
 * `FoundingAdminForm` after the recovery-code modal is dismissed).
 *
 * Body shape:
 *   { challengeToken: string,
 *     name: string,
 *     deviceLabel: string,
 *     attestation: RegistrationResponseJSON }
 *
 * NOTE: this route does NOT pass a `foundingTokenPreCheck` — the
 * `LUCIDINDEX_FOUNDING_TOKEN` env-var guard is wired in by ticket #27.
 * Until then `foundFirstAdmin()` runs with `preCheck: undefined`, which
 * means the only barrier to founding is "admins table is empty" — fine
 * for local dev where the dev server is loopback-only.
 */

import { finishFoundingEnrollment } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../lib/challenge-store'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const { challengeToken, name, deviceLabel, attestation } = body as {
    challengeToken?: unknown
    name?: unknown
    deviceLabel?: unknown
    attestation?: unknown
  }
  if (
    typeof challengeToken !== 'string' ||
    typeof name !== 'string' ||
    typeof deviceLabel !== 'string' ||
    !attestation ||
    typeof attestation !== 'object'
  ) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  try {
    // TODO(#27): pass `foundingTokenPreCheck` + `foundingTokenHash` here once
    // the LUCIDINDEX_FOUNDING_TOKEN guard lands.
    const result = await finishFoundingEnrollment({
      name,
      deviceLabel,
      response: attestation as Parameters<typeof finishFoundingEnrollment>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    return NextResponse.json({
      ok: true,
      adminId: result.adminId,
      credentialId: result.credentialId,
      recoveryCode: result.recoveryCode,
    })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
