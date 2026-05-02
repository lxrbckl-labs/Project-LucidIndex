'use client'

/**
 * Two-stage client component for founding-admin enrollment.
 *
 * Stage A — Token input:
 *   Uses `<TokenGate>` from `@/components/auth/FoundingAdminForm`. On valid
 *   token, advances to Stage B.
 *
 * Stage B — Passkey enrollment:
 *   Uses `<FoundingAdminForm>` wired to the three founding API routes.
 *   The verified token is forwarded to the `finish` endpoint for
 *   defense-in-depth.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  FoundingAdminForm,
  type FoundingAdminFormProps,
  TokenGate,
} from '@/components/auth/FoundingAdminForm'
import { verifyFoundingToken } from './actions'

type StartOk = Extract<Awaited<ReturnType<FoundingAdminFormProps['startEnrollment']>>, { ok: true }>
type StartOptions = StartOk['options']

export function FoundingPanel() {
  const router = useRouter()
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)

  // Stage A — token gate
  if (verifiedToken === null) {
    return (
      <TokenGate
        verifyToken={verifyFoundingToken}
        onVerified={(token) => setVerifiedToken(token)}
      />
    )
  }

  // Stage B — passkey enrollment (token already verified)
  const startEnrollment: FoundingAdminFormProps['startEnrollment'] = async ({ deviceLabel }) => {
    const res = await fetch('/api/auth/founding/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceLabel }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as
      | { ok: true; options: StartOptions; challengeToken: string }
      | { ok: false }
    if (!data.ok) return { ok: false }
    return { ok: true, options: data.options, challengeToken: data.challengeToken }
  }

  const finishEnrollment: FoundingAdminFormProps['finishEnrollment'] = async (input) => {
    const res = await fetch('/api/auth/founding/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: input.challengeToken,
        name: input.name,
        deviceLabel: input.deviceLabel,
        attestation: input.attestation,
        foundingToken: verifiedToken,
      }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as
      | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
      | { ok: false }
    if (!data.ok) return { ok: false }
    return {
      ok: true,
      adminId: data.adminId,
      credentialId: data.credentialId,
      recoveryCode: data.recoveryCode,
    }
  }

  const finalizeSession: FoundingAdminFormProps['finalizeSession'] = async (input) => {
    const res = await fetch('/api/auth/founding/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId: input.adminId, credentialId: input.credentialId }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok: true } | { ok: false }
    return data.ok ? { ok: true } : { ok: false }
  }

  return (
    <FoundingAdminForm
      startEnrollment={startEnrollment}
      finishEnrollment={finishEnrollment}
      finalizeSession={finalizeSession}
      onSuccess={() => {
        router.replace('/settings')
        router.refresh()
      }}
    />
  )
}
