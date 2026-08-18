'use client'

/**
 * Client wrapper for `<RegisterPasskeyForm>` from `@/components/auth/`.
 *
 * Wires the register-another-passkey API routes:
 *   POST /api/auth/passkey/register/start
 *   POST /api/auth/passkey/register/finish
 *
 * On success, calls `router.refresh()` so the server component re-fetches
 * and shows the updated credential list.
 */

import { useRouter } from 'next/navigation'
import {
  RegisterPasskeyForm as BaseForm,
  type RegisterPasskeyFormProps,
} from '@/components/auth/RegisterPasskeyForm'

type StartOk = Extract<
  Awaited<ReturnType<RegisterPasskeyFormProps['startRegistrationFn']>>,
  { ok: true }
>
type StartOptions = StartOk['options']

export function RegisterPasskeyForm() {
  const router = useRouter()

  const startRegistrationFn: RegisterPasskeyFormProps['startRegistrationFn'] = async ({
    deviceLabel,
  }) => {
    const res = await fetch('/api/auth/passkey/register/start', {
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

  const finishRegistrationFn: RegisterPasskeyFormProps['finishRegistrationFn'] = async (input) => {
    const res = await fetch('/api/auth/passkey/register/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: input.challengeToken,
        deviceLabel: input.deviceLabel,
        attestation: input.attestation,
      }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok: true } | { ok: false }
    return data.ok ? { ok: true } : { ok: false }
  }

  return (
    <BaseForm
      startRegistrationFn={startRegistrationFn}
      finishRegistrationFn={finishRegistrationFn}
      onSuccess={() => router.refresh()}
    />
  )
}
