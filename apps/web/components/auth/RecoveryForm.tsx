'use client'

/**
 * Passkey recovery form.
 *
 * Single-stage entry (recovery code) that drives a three-call ceremony:
 *   1. `startRecovery(code)` — verify the code, get registration options.
 *   2. WebAuthn `startRegistration` — enroll a NEW passkey on this device.
 *   3. `finishRecovery({ challengeToken, code, attestation })` — burn the old
 *      code, persist the credential, mint a fresh recovery code.
 * The new recovery code is shown in a Dialog (one-time display) before
 * `finalizeSession` mints the session — mirroring the founding flow so the
 * code can't be lost to an early RSC refresh.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const GENERIC_FAILURE = "Couldn't recover access — try again"
const WRONG_CODE = "That recovery code didn't match. Double-check and try again."
const RATE_LIMITED = 'Too many attempts. Wait a few minutes and try again.'

type StageName = 'idle' | 'working' | 'recovery-modal' | 'finalizing'

type PendingSession = { adminId: string; credentialId: string }

type StartResult =
  | {
      ok: true
      options: Parameters<typeof startRegistration>[0]['optionsJSON']
      challengeToken: string
    }
  | { ok: false; reason?: string }

type FinishResult =
  | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
  | { ok: false; reason?: string }

export type RecoveryFormProps = {
  startRecovery: (code: string) => Promise<StartResult>
  finishRecovery: (input: {
    challengeToken: string
    code: string
    attestation: Awaited<ReturnType<typeof startRegistration>>
  }) => Promise<FinishResult>
  finalizeSession: (input: {
    adminId: string
    credentialId: string
  }) => Promise<{ ok: true } | { ok: false }>
  onSuccess: () => void
  className?: string
}

const codeSchema = z.object({
  code: z.string().min(1, 'Recovery code is required'),
})

type CodeValues = z.infer<typeof codeSchema>

export function RecoveryForm({
  startRecovery,
  finishRecovery,
  finalizeSession,
  onSuccess,
  className,
}: RecoveryFormProps) {
  const [stage, setStage] = useState<StageName>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSession | null>(null)

  const form = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  })

  async function onSubmit(values: CodeValues) {
    if (stage !== 'idle') return
    setError(null)
    setStage('working')

    const code = values.code.trim()
    const start = await startRecovery(code)
    if (!start.ok) {
      setError(start.reason === 'rate_limited' ? RATE_LIMITED : WRONG_CODE)
      setStage('idle')
      return
    }

    try {
      const attestation = await startRegistration({ optionsJSON: start.options })
      const finish = await finishRecovery({
        challengeToken: start.challengeToken,
        code,
        attestation,
      })
      if (!finish.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }
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
      setError(GENERIC_FAILURE)
      setStage('recovery-modal')
      return
    }
    setRecoveryCode(null)
    setPending(null)
    setStage('idle')
    onSuccess()
  }

  const modalOpen = (stage === 'recovery-modal' || stage === 'finalizing') && !!recoveryCode

  return (
    <>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className={cn('flex flex-col gap-4', className)}
          data-testid="recovery-form"
        >
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recovery code</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="Enter your recovery code"
                    data-testid="recovery-code-input"
                    disabled={stage !== 'idle'}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={stage !== 'idle'}
            data-testid="recovery-submit"
            className="w-full"
          >
            {stage === 'working' ? 'Verifying…' : 'Recover Access'}
          </Button>
        </form>
      </Form>

      {/* New-recovery-code dialog — stays mounted until the session is finalized */}
      <Dialog open={modalOpen} onOpenChange={() => {}}>
        <DialogContent
          data-testid="recovery-modal"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Save your new recovery code</DialogTitle>
            <DialogDescription>
              Your old code has been used and is now invalid. This new code replaces it — store it
              somewhere safe. It's shown only once.
            </DialogDescription>
          </DialogHeader>

          <pre
            className="rounded-md bg-muted px-4 py-3 font-mono text-sm tracking-widest select-all break-all"
            data-testid="recovery-code"
          >
            {recoveryCode}
          </pre>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleDismissRecoveryModal}
              disabled={stage === 'finalizing'}
              data-testid="recovery-dismiss"
            >
              {stage === 'finalizing' ? 'Signing in…' : "I've saved it — continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
