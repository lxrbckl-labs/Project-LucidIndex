'use client'

/**
 * Passkey login form.
 *
 * Ported from Project-Showalter (`src/app/(admin)/admin/login/LoginForm.tsx`),
 * adapted for single-admin LucidIndex:
 *   - No email input. There's exactly one admin; the browser picks the
 *     credential from `allowCredentials` returned by `startLogin()`.
 *   - No `Button`/`Input` shadcn dependency — plain HTML elements with
 *     a `className` escape hatch so consumers can theme without forking.
 *   - Async server functions are passed in as props rather than imported
 *     from a hard-coded server module path. This keeps the package usable
 *     from any apps/web layout (#20 wires up the actual server actions
 *     and route handlers that wrap `startLogin`/`finishLogin`).
 */

import { startAuthentication } from '@simplewebauthn/browser'
import { type FormEvent, useState } from 'react'

const GENERIC_FAILURE = "Couldn't sign in — try again or use your recovery code"

type Stage = 'idle' | 'working'

export type LoginFormProps = {
  /**
   * Server action that wraps `@lucidindex/auth#startLogin`. Returns the
   * WebAuthn options on success, or `{ ok: false }` on any failure (no
   * enumeration leak).
   */
  startLogin: () => Promise<
    | {
        ok: true
        options: Parameters<typeof startAuthentication>[0]['optionsJSON']
        /** Token the server uses to look up the stashed challenge in step 2. */
        challengeToken: string
      }
    | { ok: false }
  >
  /**
   * Server action that wraps `@lucidindex/auth#finishLogin`. Receives the
   * challenge token from step 1 and the assertion from the browser.
   */
  finishLogin: (input: {
    challengeToken: string
    assertion: Awaited<ReturnType<typeof startAuthentication>>
  }) => Promise<{ ok: true } | { ok: false }>
  /** Called on a successful login. Use it to redirect or refresh the router. */
  onSuccess: () => void
  /** Optional className overrides for the root form. */
  className?: string
}

export function LoginForm(props: LoginFormProps) {
  const { startLogin, finishLogin, onSuccess, className } = props
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage === 'working') return
    setError(null)
    setStage('working')

    const start = await startLogin()
    if (!start.ok) {
      setError(GENERIC_FAILURE)
      setStage('idle')
      return
    }

    try {
      const assertion = await startAuthentication({ optionsJSON: start.options })
      const finish = await finishLogin({
        challengeToken: start.challengeToken,
        assertion,
      })
      if (!finish.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }
      onSuccess()
    } catch {
      setError(GENERIC_FAILURE)
      setStage('idle')
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className} data-testid="login-form">
      <button type="submit" disabled={stage === 'working'} data-testid="login-submit">
        {stage === 'working' ? 'Working…' : 'Sign in with passkey'}
      </button>

      {error && (
        <p role="alert" data-testid="login-error">
          {error}
        </p>
      )}
    </form>
  )
}
