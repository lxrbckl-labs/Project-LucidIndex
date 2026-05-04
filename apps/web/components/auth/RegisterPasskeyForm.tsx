'use client'

/**
 * "Register another passkey" form — shadcn/ui rebuild (Phase 1).
 *
 * Drives the two-step WebAuthn registration ceremony for an already-
 * authenticated admin wanting to add a second (or further) passkey.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const GENERIC_FAILURE = "Couldn't register passkey — try again."

type Stage = 'idle' | 'working'

const schema = z.object({
  deviceLabel: z.string().min(1, 'Device label is required.').max(100, 'Device label is too long.'),
})

type FormValues = z.infer<typeof schema>

export type RegisterPasskeyFormProps = {
  startRegistrationFn: (input: { deviceLabel: string }) => Promise<
    | {
        ok: true
        options: Parameters<typeof startRegistration>[0]['optionsJSON']
        challengeToken: string
      }
    | { ok: false }
  >
  finishRegistrationFn: (input: {
    challengeToken: string
    deviceLabel: string
    attestation: Awaited<ReturnType<typeof startRegistration>>
  }) => Promise<{ ok: true } | { ok: false }>
  onSuccess?: () => void
  className?: string
}

export function RegisterPasskeyForm({
  startRegistrationFn,
  finishRegistrationFn,
  onSuccess,
  className,
}: RegisterPasskeyFormProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { deviceLabel: '' },
  })

  async function onSubmit(values: FormValues) {
    if (stage === 'working') return
    setError(null)
    setSuccess(false)
    setStage('working')

    try {
      const start = await startRegistrationFn({ deviceLabel: values.deviceLabel })
      if (!start.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }

      const attestation = await startRegistration({ optionsJSON: start.options })
      const finish = await finishRegistrationFn({
        challengeToken: start.challengeToken,
        deviceLabel: values.deviceLabel,
        attestation,
      })
      if (!finish.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }

      form.reset()
      setSuccess(true)
      setStage('idle')
      onSuccess?.()
    } catch {
      setError(GENERIC_FAILURE)
      setStage('idle')
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        data-testid="register-passkey-form"
        className={`flex flex-col gap-4${className ? ` ${className}` : ''}`}
      >
        <FormField
          control={form.control}
          name="deviceLabel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Device label</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  maxLength={100}
                  placeholder="iPhone Face ID"
                  data-testid="register-device-label"
                  disabled={stage === 'working'}
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

        {success && (
          <Alert>
            <AlertDescription role="status" data-testid="register-passkey-success">
              Passkey registered successfully.
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          disabled={stage === 'working'}
          data-testid="register-passkey-submit"
          className="self-start"
        >
          {stage === 'working' ? 'Registering…' : 'Register passkey'}
        </Button>
      </form>
    </Form>
  )
}
