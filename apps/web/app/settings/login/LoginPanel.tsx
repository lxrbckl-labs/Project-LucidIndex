'use client'

/**
 * Client wrapper for `<LoginForm>` that wires the auth API routes
 * (`/api/auth/passkey/authenticate/start` + `/finish`) to the form's
 * `startLogin` / `finishLogin` props.
 */

import { useRouter } from 'next/navigation'
import { LoginForm, type LoginFormProps } from '@/components/auth/LoginForm'

type StartOk = Extract<Awaited<ReturnType<LoginFormProps['startLogin']>>, { ok: true }>
type StartOptions = StartOk['options']

export function LoginPanel() {
  const router = useRouter()

  const startLogin: LoginFormProps['startLogin'] = async () => {
    const res = await fetch('/api/auth/passkey/authenticate/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as
      | { ok: true; options: StartOptions; challengeToken: string }
      | { ok: false }
    if (!data.ok) return { ok: false }
    return { ok: true, options: data.options, challengeToken: data.challengeToken }
  }

  const finishLogin: LoginFormProps['finishLogin'] = async (input) => {
    const res = await fetch('/api/auth/passkey/authenticate/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: input.challengeToken,
        assertion: input.assertion,
      }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok: true } | { ok: false }
    return data.ok ? { ok: true } : { ok: false }
  }

  return (
    <LoginForm
      startLogin={startLogin}
      finishLogin={finishLogin}
      onSuccess={() => {
        router.replace('/settings')
        router.refresh()
      }}
    />
  )
}
