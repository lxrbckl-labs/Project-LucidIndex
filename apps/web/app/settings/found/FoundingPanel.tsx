'use client'

/**
 * Client wrapper for `<FoundingAdminForm>` that wires the Phase 1 founding
 * routes (`/api/auth/founding/start`, `/finish`, `/finalize`) to the
 * form's three server-action props.
 *
 * Three round-trips, mirroring the package's three-step ceremony:
 *   1. start → server stashes the challenge, returns options + token
 *   2. finish → server verifies attestation, persists the admin row,
 *               returns the one-time recovery code (NO session yet)
 *   3. finalize → server mints the iron-session cookie, called after
 *                 the user dismisses the recovery-code modal
 */

import { FoundingAdminForm, type FoundingAdminFormProps } from '@lucidindex/auth/react'
import { useRouter } from 'next/navigation'

type StartOk = Extract<Awaited<ReturnType<FoundingAdminFormProps['startEnrollment']>>, { ok: true }>
type StartOptions = StartOk['options']

export function FoundingPanel() {
  const router = useRouter()

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
      className="flex flex-col gap-4"
    />
  )
}
