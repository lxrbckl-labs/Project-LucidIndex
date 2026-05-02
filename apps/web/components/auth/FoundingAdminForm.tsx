'use client'

/**
 * Founding-admin enrollment form — shadcn/ui rebuild (Phase 1).
 *
 * Two-stage flow:
 *   Stage A — token input: masked field, calls `verifyFoundingToken` server
 *             action on submit, advances to Stage B on success.
 *   Stage B — passkey enrollment: name field + WebAuthn ceremony. Recovery
 *             code is shown in a shadcn Dialog before the session is minted.
 *
 * Device label is hardcoded to 'Founding device' (input removed per spec).
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

const GENERIC_FAILURE = "Couldn't claim founding admin — try again"
const DEFAULT_DEVICE_LABEL = 'Founding device'

type StageName = 'idle' | 'working' | 'recovery-modal' | 'finalizing'

type PendingSession = {
  adminId: string
  credentialId: string
}

// ── Types mirroring the original FoundingAdminFormProps ──────────────────────

type StartResult =
  | {
      ok: true
      options: Parameters<typeof startRegistration>[0]['optionsJSON']
      challengeToken: string
    }
  | { ok: false }

type FinishResult =
  | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
  | { ok: false }

export type FoundingAdminFormProps = {
  startEnrollment: (input: { deviceLabel: string }) => Promise<StartResult>
  finishEnrollment: (input: {
    challengeToken: string
    name: string
    deviceLabel: string
    attestation: Awaited<ReturnType<typeof startRegistration>>
  }) => Promise<FinishResult>
  finalizeSession: (input: {
    adminId: string
    credentialId: string
  }) => Promise<{ ok: true } | { ok: false }>
  onSuccess: () => void
  /** Token already verified in Stage A. */
  verifiedToken?: string
  className?: string
}

// ── Stage A token form schema ─────────────────────────────────────────────────

const tokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
})

type TokenValues = z.infer<typeof tokenSchema>

// ── Stage B name form schema ──────────────────────────────────────────────────

const nameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
})

type NameValues = z.infer<typeof nameSchema>

// ── Stage A: token gate (separate sub-component) ─────────────────────────────

type TokenGateProps = {
  onVerified: (token: string) => void
  verifyToken: (candidate: string) => Promise<{ ok: boolean }>
}

function TokenGate({ onVerified, verifyToken }: TokenGateProps) {
  const [error, setError] = useState<string | null>(null)

  const form = useForm<TokenValues>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { token: '' },
  })

  async function onSubmit(values: TokenValues) {
    setError(null)
    try {
      const result = await verifyToken(values.token)
      if (result.ok) {
        onVerified(values.token)
      } else {
        setError('Token is incorrect. Double-check and try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify founding token</CardTitle>
        <CardDescription>Enter your founding token to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Founding token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="Paste your founding token"
                      data-testid="founding-token-input"
                      disabled={form.formState.isSubmitting}
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
              disabled={form.formState.isSubmitting}
              data-testid="founding-token-submit"
              className="self-start"
            >
              {form.formState.isSubmitting ? 'Verifying…' : 'Continue'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

// ── Stage B: passkey enrollment ───────────────────────────────────────────────

export function FoundingAdminForm({
  startEnrollment,
  finishEnrollment,
  finalizeSession,
  onSuccess,
  className,
}: FoundingAdminFormProps) {
  const [stage, setStage] = useState<StageName>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSession | null>(null)

  const form = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  async function onSubmit(values: NameValues) {
    if (stage !== 'idle') return
    setError(null)
    setStage('working')

    const start = await startEnrollment({ deviceLabel: DEFAULT_DEVICE_LABEL })
    if (!start.ok) {
      setError(GENERIC_FAILURE)
      setStage('idle')
      return
    }

    try {
      const attestation = await startRegistration({ optionsJSON: start.options })
      const finish = await finishEnrollment({
        challengeToken: start.challengeToken,
        name: values.name.trim(),
        deviceLabel: DEFAULT_DEVICE_LABEL,
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
    <Card className={className}>
      <CardHeader>
        <CardTitle>Claim founding admin</CardTitle>
        <CardDescription>
          Enroll a passkey on this device to take ownership of this LucidIndex.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your name</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="name"
                      maxLength={100}
                      placeholder="Alex"
                      data-testid="founding-name"
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
              data-testid="founding-submit"
              className="self-start"
            >
              {stage === 'working' ? 'Enrolling…' : 'Claim founding admin'}
            </Button>
          </form>
        </Form>
      </CardContent>

      {/* Recovery code dialog — stays mounted until session is finalized */}
      <Dialog open={modalOpen} onOpenChange={() => {}}>
        <DialogContent
          data-testid="recovery-modal"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Save your recovery code</DialogTitle>
            <DialogDescription>
              This code will be shown once. Store it somewhere safe — it's the only way to regain
              access if you lose your passkey device.
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
    </Card>
  )
}

export { TokenGate }
