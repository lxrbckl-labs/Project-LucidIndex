'use client'

/**
 * SettingsAuthGate — the signed-out admin auth gate.
 *
 * Rendered INLINE by the settings layout (no server redirect — a redirect to
 * `/settings/login` during a soft navigation makes Next's router loop on
 * history.replaceState, so the page "loads nothing" until a hard refresh).
 *
 * Forum-gate-style swipe card with two panes:
 *   0 — Sign In: passkey ceremony + a "Forgot passkey?" link.
 *   1 — Passcode: enter the reusable passcode to sign in (no passkey needed).
 *
 * Mechanics mirror ForumGate: a translateX slide-track whose height animates
 * to the active pane (ResizeObserver), inactive panes inert.
 */

import { startAuthentication } from '@simplewebauthn/browser'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, forwardRef, type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LoginFormProps } from './LoginForm'

type Mode = 'signin' | 'passcode'
const MODE_INDEX: Record<Mode, number> = { signin: 0, passcode: 1 }

type StartOk = Extract<Awaited<ReturnType<LoginFormProps['startLogin']>>, { ok: true }>
type StartOptions = StartOk['options']

export function SettingsAuthGate() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [pending, setPending] = useState(false)
  const index = MODE_INDEX[mode]

  // Animate the track wrapper to the active pane's height (so the shorter
  // pane doesn't leave a dead band). Mirrors ForumGate.
  const signinRef = useRef<HTMLDivElement>(null)
  const passcodeRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = mode === 'signin' ? signinRef.current : passcodeRef.current
    if (!node) return
    const update = () => setTrackHeight(node.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  // On any successful sign-in, refresh so the server re-renders the layout
  // with the now-set session and the gate falls away.
  const onAuthed = () => {
    router.replace('/settings')
    router.refresh()
  }

  // ── Passkey wiring (pane 0) ──────────────────────────────────────────────
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
      body: JSON.stringify({ challengeToken: input.challengeToken, assertion: input.assertion }),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok: true } | { ok: false }
    return data.ok ? { ok: true } : { ok: false }
  }

  // Passkey ceremony, inlined to mirror ForumGate's idle-view button group
  // (errors surface as toasts, like the forum).
  async function handlePasskeySignIn() {
    if (pending) return
    setPending(true)
    try {
      const start = await startLogin()
      if (!start.ok) {
        toast.error("Sign in isn't available right now.")
        return
      }
      let assertion: Awaited<ReturnType<typeof startAuthentication>>
      try {
        assertion = await startAuthentication({ optionsJSON: start.options })
      } catch (err) {
        // User cancelled or no matching passkey — the platform UI already explained.
        if (err instanceof Error && err.name === 'NotAllowedError') return
        toast.error("Couldn't read a passkey for this device.")
        return
      }
      const finish = await finishLogin({ challengeToken: start.challengeToken, assertion })
      if (!finish.ok) {
        toast.error("That passkey doesn't sign you in here.")
        return
      }
      onAuthed()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex flex-col items-center gap-5 rounded-xl border bg-background p-6 shadow-sm max-w-sm w-full text-center">
      <div
        className="w-full overflow-hidden transition-[height] duration-300 ease-out"
        style={trackHeight !== undefined ? { height: trackHeight } : undefined}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <Pane ref={signinRef} active={mode === 'signin'}>
            <div className="flex flex-col items-center gap-4 w-full">
              <h2 className="text-xl font-semibold tracking-tight">Sign In</h2>
              <p className="text-xs text-muted-foreground leading-relaxed text-justify">
                Use the passkey on this device to access Settings.
              </p>
              <div className="flex flex-col gap-2 w-full">
                <Button
                  type="button"
                  onClick={handlePasskeySignIn}
                  disabled={pending}
                  className="w-full"
                  data-testid="login-submit"
                >
                  {pending ? 'Signing in…' : 'Sign In'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode('passcode')}
                  disabled={pending}
                  className="w-full"
                  data-testid="forgot-passkey"
                >
                  Forgot Passkey?
                </Button>
              </div>
            </div>
          </Pane>

          <Pane ref={passcodeRef} active={mode === 'passcode'}>
            <PasscodePane
              isActive={mode === 'passcode'}
              onBack={() => setMode('signin')}
              onAuthed={onAuthed}
            />
          </Pane>
        </div>
      </div>
    </div>
  )
}

const Pane = forwardRef<HTMLDivElement, { active: boolean; children: ReactNode }>(function Pane(
  { active, children },
  ref,
) {
  return (
    <div
      ref={ref}
      className="w-full shrink-0 px-px"
      aria-hidden={active ? undefined : true}
      tabIndex={active ? undefined : -1}
      inert={active ? undefined : true}
    >
      {children}
    </div>
  )
})

function PasscodePane({
  isActive,
  onBack,
  onAuthed,
}: {
  isActive: boolean
  onBack: () => void
  onAuthed: () => void
}) {
  const [passcode, setPasscode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input once the pane slides in (wait out the 300ms transition).
  useEffect(() => {
    if (!isActive) return
    const t = setTimeout(() => inputRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [isActive])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const code = passcode.trim()
    if (!code) {
      setError('Enter your passcode.')
      inputRef.current?.focus()
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/passcode/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: code }),
      })
      const data = (await res.json()) as { ok: true } | { ok: false; reason?: string }
      if (data.ok) {
        onAuthed()
        return
      }
      setError(
        data.reason === 'rate_limited'
          ? 'Too many attempts. Wait a few minutes and try again.'
          : "That passcode didn't match. Check it and try again.",
      )
    } catch {
      setError('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 w-full text-left">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Enter passcode</h2>
        <p className="text-xs text-muted-foreground">
          Use your passcode to sign in without your passkey.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="passcode">Passcode</Label>
        <Input
          ref={inputRef}
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          disabled={pending}
          placeholder="lipc_…"
          data-testid="passcode-input"
          className="font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} data-testid="passcode-submit" className="w-full">
          {pending ? 'Signing in…' : 'Sign In'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={pending}
          className="w-full"
        >
          <ArrowLeft className="h-6 w-6 mr-2" />
          Back
        </Button>
      </div>
    </form>
  )
}
