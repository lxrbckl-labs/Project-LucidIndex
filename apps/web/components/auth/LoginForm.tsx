'use client'

/**
 * Passkey login form — shadcn/ui rebuild (Phase 1).
 *
 * No email input — single admin, browser picks the credential from
 * `allowCredentials` returned by the server. One button, one error state.
 */

import { startAuthentication } from '@simplewebauthn/browser'
import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const GENERIC_FAILURE = "Couldn't sign in — try again or use your recovery code"

type Stage = 'idle' | 'working'

export type LoginFormProps = {
  startLogin: () => Promise<
    | {
        ok: true
        options: Parameters<typeof startAuthentication>[0]['optionsJSON']
        challengeToken: string
      }
    | { ok: false }
  >
  finishLogin: (input: {
    challengeToken: string
    assertion: Awaited<ReturnType<typeof startAuthentication>>
  }) => Promise<{ ok: true } | { ok: false }>
  onSuccess: () => void
  className?: string
}

export function LoginForm({ startLogin, finishLogin, onSuccess, className }: LoginFormProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
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
    <Card className={className}>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} data-testid="login-form" className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={stage === 'working'}
            data-testid="login-submit"
            className="w-full"
          >
            {stage === 'working' ? 'Working…' : 'Sign in with passkey'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
