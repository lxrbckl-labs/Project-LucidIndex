'use client'

/**
 * Client wrapper for `<RecoveryForm>` that wires the recovery API routes
 * (`/api/auth/recovery/start` → `/finish` → `/finalize`) to the form's
 * `startRecovery` / `finishRecovery` / `finalizeSession` props.
 */

import { useRouter } from 'next/navigation'
import { RecoveryForm, type RecoveryFormProps } from '@/components/auth/RecoveryForm'

type StartOk = Extract<Awaited<ReturnType<RecoveryFormProps['startRecovery']>>, { ok: true }>
type StartOptions = StartOk['options']

export function RecoveryPanel() {
  const router = useRouter()

  const startRecovery: RecoveryFormProps['startRecovery'] = async (code) => {
    const res = await fetch('/api/auth/recovery/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recoveryCode: code }),
    })
    let data:
      | { ok: true; options: StartOptions; challengeToken: string }
      | { ok: false; reason?: string }
    try {
      data = await res.json()
    } catch {
      return { ok: false }
    }
    if (!data.ok) return { ok: false, reason: data.reason }
    return { ok: true, options: data.options, challengeToken: data.challengeToken }
  }

  const finishRecovery: RecoveryFormProps['finishRecovery'] = async ({
    challengeToken,
    code,
    attestation,
  }) => {
    const res = await fetch('/api/auth/recovery/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeToken, recoveryCode: code, attestation }),
    })
    let data:
      | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
      | { ok: false; reason?: string }
    try {
      data = await res.json()
    } catch {
      return { ok: false }
    }
    if (!data.ok) return { ok: false, reason: data.reason }
    return {
      ok: true,
      adminId: data.adminId,
      credentialId: data.credentialId,
      recoveryCode: data.recoveryCode,
    }
  }

  const finalizeSession: RecoveryFormProps['finalizeSession'] = async (input) => {
    const res = await fetch('/api/auth/recovery/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId: input.adminId, credentialId: input.credentialId }),
    })
    let data: { ok: true } | { ok: false }
    try {
      data = await res.json()
    } catch {
      return { ok: false }
    }
    return data.ok ? { ok: true } : { ok: false }
  }

  return (
    <RecoveryForm
      startRecovery={startRecovery}
      finishRecovery={finishRecovery}
      finalizeSession={finalizeSession}
      onSuccess={() => {
        router.replace('/settings')
        router.refresh()
      }}
    />
  )
}
