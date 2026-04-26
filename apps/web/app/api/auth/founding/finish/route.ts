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
 *     attestation: RegistrationResponseJSON,
 *     foundingToken: string }
 *
 * Defense-in-depth (ticket #27): the `foundingToken` field is verified here
 * inside the `finishFoundingEnrollment` transaction preCheck, even though
 * the route-level page gate already validated it. This ensures a direct API
 * call (bypassing the page) is also rejected.
 */

import { finishFoundingEnrollment } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../lib/challenge-store'
import {
  foundingTokenIsConfigured,
  foundingTokenMatches,
  hashFoundingToken,
} from '../../../../../lib/founding-token'

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
  const { challengeToken, name, deviceLabel, attestation, foundingToken } = body as {
    challengeToken?: unknown
    name?: unknown
    deviceLabel?: unknown
    attestation?: unknown
    foundingToken?: unknown
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

  // Defense-in-depth: verify the founding token before we even touch the
  // challenge store. This blocks direct API calls that skip the page gate.
  // We only enforce the check when the env var is configured — if it's not
  // set, the page would have shown "enrollment disabled" and the form never
  // rendered, but a direct call without the token is also meaningless.
  if (foundingTokenIsConfigured()) {
    const candidateToken = typeof foundingToken === 'string' ? foundingToken : undefined
    if (!foundingTokenMatches(candidateToken)) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  // Compute the token hash once — passed as foundingTokenHash to persist on
  // the admin row, and used in the preCheck hook to guard the transaction.
  const tokenStr = typeof foundingToken === 'string' ? foundingToken : ''
  const tokenHash =
    foundingTokenIsConfigured() && tokenStr ? hashFoundingToken(tokenStr) : undefined

  try {
    const result = await finishFoundingEnrollment({
      name,
      deviceLabel,
      response: attestation as Parameters<typeof finishFoundingEnrollment>[0]['response'],
      expectedChallenge,
      foundingTokenHash: tokenHash,
      foundingTokenPreCheck: foundingTokenIsConfigured()
        ? async () => {
            // Re-verify inside the transaction: defense-in-depth so even if the
            // pre-transaction check above were somehow bypassed, the insert
            // never happens without a valid token match.
            const candidate = typeof foundingToken === 'string' ? foundingToken : undefined
            if (!foundingTokenMatches(candidate)) {
              return { ok: false }
            }
            return { ok: true }
          }
        : undefined,
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
