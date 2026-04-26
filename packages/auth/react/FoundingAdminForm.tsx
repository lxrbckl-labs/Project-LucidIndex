'use client'

/**
 * Founding-admin enrollment form.
 *
 * Ported from Project-Showalter
 * (`src/app/(admin)/admin/login/FoundingAdminForm.tsx`), adapted for
 * single-admin LucidIndex:
 *   - No email field. LucidIndex admins have only a `name`.
 *   - Adds a `deviceLabel` field (defaults to "MacBook" / "iPhone" etc.)
 *     because LucidIndex tracks per-credential device labels.
 *   - Server actions are passed in as props (see `LoginForm.tsx` for
 *     the same rationale).
 *   - Recovery-code modal is rendered inline (no shared `RecoveryCodeModal`
 *     component to import) — consumers can supply a custom one via the
 *     `renderRecoveryModal` prop.
 *
 * Session minting is deferred until AFTER the recovery-code modal is
 * dismissed, mirroring Showalter — minting earlier triggers an RSC
 * refresh that unmounts this form before the user can copy the code.
 */

import { startRegistration } from '@simplewebauthn/browser'
import { type FormEvent, type ReactNode, useState } from 'react'

// Minimal shape of the input element we read in onChange handlers. Spelled
// out structurally so this file type-checks even in consumer projects whose
// tsconfig doesn't pull in the DOM lib (e.g. apps/web — see #18). React's
// own input typings are richer than this but they require DOM types to
// resolve `HTMLInputElement.value`.
type InputLike = { value: string }

const GENERIC_FAILURE = "Couldn't claim founding admin — try again"

type Stage = 'idle' | 'working' | 'recovery-modal' | 'finalizing'

type PendingSession = {
  adminId: string
  credentialId: string
}

export type FoundingAdminFormProps = {
  /**
   * Server action wrapping `@lucidindex/auth#startFoundingEnrollment`.
   * Returns the WebAuthn registration options + a token the server uses
   * to look up the stashed challenge in step 2.
   */
  startEnrollment: (input: { deviceLabel: string }) => Promise<
    | {
        ok: true
        options: Parameters<typeof startRegistration>[0]['optionsJSON']
        challengeToken: string
      }
    | { ok: false }
  >
  /**
   * Server action wrapping `@lucidindex/auth#finishFoundingEnrollment`.
   * Returns the plaintext recovery code (one-time display) on success.
   */
  finishEnrollment: (input: {
    challengeToken: string
    name: string
    deviceLabel: string
    attestation: Awaited<ReturnType<typeof startRegistration>>
  }) => Promise<
    { ok: true; adminId: string; credentialId: string; recoveryCode: string } | { ok: false }
  >
  /** Server action wrapping `@lucidindex/auth#finalizeFoundingSession`. */
  finalizeSession: (input: {
    adminId: string
    credentialId: string
  }) => Promise<{ ok: true } | { ok: false }>
  /** Called after `finalizeSession` succeeds and the modal is dismissed. */
  onSuccess: () => void
  /** Optional custom modal renderer; the default is a minimal inline panel. */
  renderRecoveryModal?: (args: { code: string; busy: boolean; onDismiss: () => void }) => ReactNode
  /** className for the root form element. */
  className?: string
}

export function FoundingAdminForm(props: FoundingAdminFormProps) {
  const {
    startEnrollment,
    finishEnrollment,
    finalizeSession,
    onSuccess,
    renderRecoveryModal,
    className,
  } = props
  const [name, setName] = useState('')
  const [deviceLabel, setDeviceLabel] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSession | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage !== 'idle') return
    setError(null)
    if (!name.trim() || !deviceLabel.trim()) {
      setError(GENERIC_FAILURE)
      return
    }
    setStage('working')

    const start = await startEnrollment({ deviceLabel: deviceLabel.trim() })
    if (!start.ok) {
      setError(GENERIC_FAILURE)
      setStage('idle')
      return
    }

    try {
      const attestation = await startRegistration({ optionsJSON: start.options })
      const finish = await finishEnrollment({
        challengeToken: start.challengeToken,
        name: name.trim(),
        deviceLabel: deviceLabel.trim(),
        attestation,
      })
      if (!finish.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }
      // Admin row exists server-side, but no session has been minted yet.
      // Show the recovery code BEFORE we mint — minting triggers an RSC
      // refresh that would unmount this form.
      setPending({ adminId: finish.adminId, credentialId: finish.credentialId })
      setRecoveryCode(finish.recoveryCode)
      setStage('recovery-modal')
    } catch {
      setError(GENERIC_FAILURE)
      setStage('idle')
    }
  }

  async function handleDismissRecoveryModal() {
    if (!pending) return
    setStage('finalizing')
    setError(null)
    const result = await finalizeSession(pending)
    if (!result.ok) {
      // Keep the modal up so the user doesn't lose the code, but show the
      // failure so they know they need to log in manually.
      setError(GENERIC_FAILURE)
      setStage('recovery-modal')
      return
    }
    setRecoveryCode(null)
    setPending(null)
    setStage('idle')
    onSuccess()
  }

  const showModal = (stage === 'recovery-modal' || stage === 'finalizing') && recoveryCode

  return (
    <>
      <form onSubmit={handleSubmit} className={className} data-testid="founding-form">
        <label>
          <span>Your name</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName((e.currentTarget as unknown as InputLike).value)}
            disabled={stage !== 'idle'}
            data-testid="founding-name"
            placeholder="Alex"
          />
        </label>

        <label>
          <span>This device</span>
          <input
            type="text"
            name="deviceLabel"
            required
            maxLength={100}
            value={deviceLabel}
            onChange={(e) => setDeviceLabel((e.currentTarget as unknown as InputLike).value)}
            disabled={stage !== 'idle'}
            data-testid="founding-device"
            placeholder="MacBook TouchID"
          />
        </label>

        <button type="submit" disabled={stage !== 'idle'} data-testid="founding-submit">
          {stage === 'working' ? 'Enrolling…' : 'Claim founding admin'}
        </button>

        {error && (
          <p role="alert" data-testid="founding-error">
            {error}
          </p>
        )}
      </form>

      {showModal &&
        (renderRecoveryModal ? (
          renderRecoveryModal({
            code: recoveryCode,
            busy: stage === 'finalizing',
            onDismiss: handleDismissRecoveryModal,
          })
        ) : (
          <DefaultRecoveryModal
            code={recoveryCode}
            busy={stage === 'finalizing'}
            onDismiss={handleDismissRecoveryModal}
          />
        ))}
    </>
  )
}

/**
 * Minimal default modal — consumers should style this or pass
 * `renderRecoveryModal` to swap in their own. Kept dependency-free so the
 * package doesn't drag a dialog primitive into every consumer.
 */
function DefaultRecoveryModal(props: { code: string; busy: boolean; onDismiss: () => void }) {
  return (
    <div role="dialog" aria-modal="true" data-testid="recovery-modal">
      <h2>Save your recovery code</h2>
      <p>
        This code will be shown once. Store it somewhere safe — it's the only way to regain access
        if you lose your passkey device.
      </p>
      <pre data-testid="recovery-code">{props.code}</pre>
      <button
        type="button"
        onClick={props.onDismiss}
        disabled={props.busy}
        data-testid="recovery-dismiss"
      >
        {props.busy ? 'Signing in…' : "I've saved it — continue"}
      </button>
    </div>
  )
}
