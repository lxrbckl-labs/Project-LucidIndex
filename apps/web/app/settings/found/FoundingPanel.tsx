'use client'

/**
 * Two-stage client component for founding-admin enrollment.
 *
 * Stage A — Token input:
 *   Renders a masked token field and a "Continue" button. On submit, calls
 *   `verifyFoundingToken` (server action). Valid token → advance to Stage B.
 *   Invalid token → inline error, stay on Stage A.
 *
 * Stage B — Passkey enrollment:
 *   Renders `<FoundingAdminForm>` wired to the three founding API routes
 *   (`/api/auth/founding/start`, `/finish`, `/finalize`). The verified token
 *   is forwarded to the `finish` endpoint for defense-in-depth — the server
 *   still rejects a mismatched token even on a direct API call.
 *
 * Three round-trips in Stage B, mirroring the package's three-step ceremony:
 *   1. start → server stashes the challenge, returns options + challengeToken
 *   2. finish → server verifies attestation + founding-token preCheck,
 *               persists the admin row, returns the one-time recovery code
 *               (NO session yet)
 *   3. finalize → server mints the iron-session cookie, called after
 *                 the user dismisses the recovery-code modal
 */

import { FoundingAdminForm, type FoundingAdminFormProps } from '@lucidindex/auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { verifyFoundingToken } from './actions'

type StartOk = Extract<Awaited<ReturnType<FoundingAdminFormProps['startEnrollment']>>, { ok: true }>
type StartOptions = StartOk['options']

export function FoundingPanel() {
  const router = useRouter()

  // Stage A state
  const [tokenInput, setTokenInput] = useState('')
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTokenError(null)
    setVerifying(true)
    try {
      const result = await verifyFoundingToken(tokenInput)
      if (result.ok) {
        setVerifiedToken(tokenInput)
      } else {
        setTokenError('Token is incorrect. Double-check and try again.')
      }
    } catch {
      setTokenError('Something went wrong. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  // Stage A — token gate
  if (verifiedToken === null) {
    return (
      <form onSubmit={handleTokenSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="founding-token" className="text-sm font-medium text-neutral-700">
            Founding token
          </label>
          <input
            id="founding-token"
            type="password"
            autoComplete="off"
            required
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste your founding token"
            data-testid="founding-token-input"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50"
            disabled={verifying}
          />
          {tokenError && (
            <p className="text-sm text-red-600" role="alert">
              {tokenError}
            </p>
          )}
        </div>
        <button
          type="submit"
          data-testid="founding-token-submit"
          disabled={verifying || tokenInput.length === 0}
          className="self-start rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {verifying ? 'Verifying…' : 'Continue'}
        </button>
      </form>
    )
  }

  // Stage B — passkey enrollment form (token already verified)
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
      className="flex flex-col gap-4"
    />
  )
}
