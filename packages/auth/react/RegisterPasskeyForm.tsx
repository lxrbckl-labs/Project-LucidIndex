'use client'

/**
 * "Register another passkey" form.
 *
 * Drives the two-step WebAuthn registration ceremony for an already-
 * authenticated admin wanting to add a second (or further) passkey.
 *
 * Server actions are passed in as props — same rationale as LoginForm and
 * FoundingAdminForm: the form lives in the shared auth package, the
 * consuming app (apps/web) knows the route URLs.
 */

import { startRegistration } from '@simplewebauthn/browser'
import { type FormEvent, useState } from 'react'

const GENERIC_FAILURE = "Couldn't register passkey — try again."

type Stage = 'idle' | 'working'

export type RegisterPasskeyFormProps = {
  /**
   * Called once to get WebAuthn registration options from the server.
   * Returns options + a challengeToken to carry back in `finishRegistration`.
   */
  startRegistrationFn: (input: { deviceLabel: string }) => Promise<
    | {
        ok: true
        options: Parameters<typeof startRegistration>[0]['optionsJSON']
        challengeToken: string
      }
    | { ok: false }
  >
  /**
   * Called after the browser ceremony completes. The server verifies the
   * attestation and inserts the new credential.
   */
  finishRegistrationFn: (input: {
    challengeToken: string
    deviceLabel: string
    attestation: Awaited<ReturnType<typeof startRegistration>>
  }) => Promise<{ ok: true } | { ok: false }>
  /** Called after a successful registration (e.g. to refresh the page). */
  onSuccess?: () => void
  /** className override for the root form element. */
  className?: string
}

export function RegisterPasskeyForm(props: RegisterPasskeyFormProps) {
  const { startRegistrationFn, finishRegistrationFn, onSuccess, className } = props
  const [deviceLabel, setDeviceLabel] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage === 'working') return
    const label = deviceLabel.trim()
    if (!label) {
      setError('Device label is required.')
      return
    }
    setError(null)
    setSuccess(false)
    setStage('working')

    try {
      const start = await startRegistrationFn({ deviceLabel: label })
      if (!start.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }

      const attestation = await startRegistration({ optionsJSON: start.options })

      const finish = await finishRegistrationFn({
        challengeToken: start.challengeToken,
        deviceLabel: label,
        attestation,
      })
      if (!finish.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }

      setDeviceLabel('')
      setSuccess(true)
      setStage('idle')
      onSuccess?.()
    } catch {
      setError(GENERIC_FAILURE)
      setStage('idle')
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className} data-testid="register-passkey-form">
      <label>
        <span>Device label</span>
        <input
          type="text"
          name="deviceLabel"
          required
          maxLength={100}
          placeholder="iPhone Face ID"
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.currentTarget.value)}
          disabled={stage === 'working'}
          data-testid="register-device-label"
        />
      </label>

      <button type="submit" disabled={stage === 'working'} data-testid="register-passkey-submit">
        {stage === 'working' ? 'Registering…' : 'Register passkey'}
      </button>

      {error && (
        <p role="alert" data-testid="register-passkey-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" data-testid="register-passkey-success">
          Passkey registered successfully.
        </p>
      )}
    </form>
  )
}
