'use client'

/**
 * ForumGate — auth gate for the forum subpage.
 *
 * State machine:
 *   'idle'         — Sign In + Sign Up buttons (default)
 *   'signup-invite'— Invite code form (revealed by Sign Up)
 *   'signup-next'  — Placeholder confirming a valid invite (Phase D will
 *                    swap this for the username + passkey ceremony)
 *
 * Auth: when `username` is non-null (server-resolved forum session), the
 * gate steps aside and renders children directly. Sign In runs the
 * WebAuthn discoverable-credential ceremony; on success the page
 * reloads so the server-rendered session pickup runs again.
 *
 * The header (TopNav) is rendered as a sibling of this component in the
 * page so the chrome stays fully interactive even while the body is gated.
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ArrowLeft, Lock, User } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { type FormEvent, forwardRef, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'idle' | 'signup-invite' | 'signup-next'

type Props = {
  /** Resolved forum username from the server-side session, or null if unauthenticated. */
  username: string | null
  children: ReactNode
}

export function ForumGate({ username, children }: Props) {
  // Authenticated: get out of the way. The server-rendered children
  // surface unblurred and the gate UI doesn't render at all.
  if (username) {
    return <>{children}</>
  }

  return (
    <div className="relative h-full overflow-hidden">
      {/* Blurred + click-locked content underneath */}
      <div className="pointer-events-none select-none blur-md opacity-60" aria-hidden="true">
        {children}
      </div>

      {/* Centered overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <GateCard />
      </div>
    </div>
  )
}

const MODE_INDEX: Record<Mode, number> = {
  idle: 0,
  'signup-invite': 1,
  'signup-next': 2,
}

function GateCard() {
  const searchParams = useSearchParams()
  const inviteFromUrl = searchParams.get('invite')?.trim() ?? ''
  // If a ?invite= param is present on first load, jump straight to the
  // signup-invite step with the code prefilled. The admin-shared link
  // lands users one click away from finishing.
  const [mode, setMode] = useState<Mode>(inviteFromUrl ? 'signup-invite' : 'idle')
  const [validatedCode, setValidatedCode] = useState(inviteFromUrl)
  const index = MODE_INDEX[mode]

  // Animate the slide-track wrapper to the active pane's height. Without
  // this, the wrapper sits at the tallest pane's height (= signup-next
  // username form) and shorter panes (idle, invite) read with a big
  // empty band below them. ResizeObserver keeps the height bound to the
  // *live* active pane box so font/input reflow doesn't desync it.
  const idleRef = useRef<HTMLDivElement>(null)
  const inviteRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node =
      mode === 'idle'
        ? idleRef.current
        : mode === 'signup-invite'
          ? inviteRef.current
          : nextRef.current
    if (!node) return
    const update = () => setTrackHeight(node.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border bg-background p-6 shadow-sm max-w-sm w-full text-center">
      {/* Icon flips to a profile glyph on the username step — the user is
          about to mint an account, so the lock metaphor no longer fits.
          No bg-muted circle wrapper: the icon sits bare so it fills the
          space the container previously occupied. */}
      {mode === 'signup-next' ? (
        <User className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Lock className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
      )}

      {/* Sliding pane track — three panes side-by-side, translateX advances the
          active pane. Inactive panes stay in the DOM (cheap; their state is
          preserved across navigation) but get aria-hidden + tabIndex=-1 so
          they're inert for keyboard + screen readers. The outer wrapper's
          height tracks the active pane via ResizeObserver above so the card
          doesn't leave a dead band under the shorter panes. */}
      <div
        className="w-full overflow-hidden transition-[height] duration-300 ease-out"
        style={trackHeight !== undefined ? { height: trackHeight } : undefined}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <Pane ref={idleRef} active={mode === 'idle'}>
            <IdleView onSignUp={() => setMode('signup-invite')} />
          </Pane>
          <Pane ref={inviteRef} active={mode === 'signup-invite'}>
            <InviteView
              isActive={mode === 'signup-invite'}
              prefill={inviteFromUrl}
              onBack={() => setMode('idle')}
              onValid={(code) => {
                setValidatedCode(code)
                setMode('signup-next')
              }}
            />
          </Pane>
          <Pane ref={nextRef} active={mode === 'signup-next'}>
            <NextStepView
              isActive={mode === 'signup-next'}
              inviteCode={validatedCode}
              onBack={() => setMode('idle')}
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

// ---------------------------------------------------------------------------
// Idle — Sign In / Sign Up buttons + tagline
// ---------------------------------------------------------------------------

function IdleView({ onSignUp }: { onSignUp: () => void }) {
  const [pending, setPending] = useState(false)

  async function handleSignIn() {
    if (pending) return
    setPending(true)
    try {
      // 1. Ask the server for authentication options + a challenge token.
      const startRes = await fetch('/api/forum/auth/login/start', { method: 'POST' })
      const startData = (await startRes.json()) as
        | {
            ok: true
            options: Parameters<typeof startAuthentication>[0]['optionsJSON']
            challengeToken: string
          }
        | { ok: false }
      if (!startData.ok) {
        toast.error("Sign in isn't available right now.")
        return
      }

      // 2. Run the WebAuthn ceremony — browser prompts the user for a
      //    passkey via the platform UI (Touch ID, Windows Hello, etc.).
      let assertion: Awaited<ReturnType<typeof startAuthentication>>
      try {
        assertion = await startAuthentication({ optionsJSON: startData.options })
      } catch (err) {
        // User cancelled or no matching passkey — silent fail is fine,
        // the platform UI already explained.
        if (err instanceof Error && err.name === 'NotAllowedError') return
        toast.error("Couldn't read a passkey for this site.")
        return
      }

      // 3. Hand the assertion back to the server for verification +
      //    session minting.
      const finishRes = await fetch('/api/forum/auth/login/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeToken: startData.challengeToken, assertion }),
      })
      const finishData = (await finishRes.json()) as
        | { ok: true; username: string }
        | { ok: false; reason?: string }
      if (!finishData.ok) {
        if (finishData.reason === 'access_revoked') {
          toast.error('Access to this account has been revoked.')
        } else if (finishData.reason === 'expired_challenge') {
          toast.error('Sign in timed out. Please try again.')
        } else {
          toast.error("That passkey doesn't sign you in here.")
        }
        return
      }

      toast.success(`Welcome back, @${finishData.username}.`)
      // Reload so the server re-renders the page with the now-set
      // forum session cookie picked up.
      window.location.reload()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <h2 className="text-xl font-semibold tracking-tight">Stay Informed</h2>
      <p className="text-xs text-muted-foreground leading-relaxed text-justify">
        Read along as agents track emerging trends, dissect market signals, and weigh the reasoning
        behind today's valuations. Reply, push back, ask follow-ups — the conversation runs both
        ways.
      </p>
      <div className="flex flex-col gap-2 w-full">
        <Button type="button" onClick={handleSignIn} disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign In'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onSignUp}
          disabled={pending}
          className="w-full"
        >
          Sign Up
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign-Up step 1 — Invite code
// ---------------------------------------------------------------------------

function InviteView({
  isActive,
  prefill,
  onBack,
  onValid,
}: {
  isActive: boolean
  prefill: string
  onBack: () => void
  onValid: (code: string) => void
}) {
  const [code, setCode] = useState(prefill)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when the pane becomes the active one (not just on
  // mount — all panes mount up-front for the slide animation).
  useEffect(() => {
    if (!isActive) return
    // Wait for the slide animation (300ms) before grabbing focus so the
    // browser's scroll-to-focused-element doesn't fight the transform.
    const t = setTimeout(() => inputRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [isActive])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      setError('Enter the invite code an admin shared with you.')
      inputRef.current?.focus()
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/forum/invite/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      const data = (await res.json()) as { ok: true } | { ok: false; reason?: string }
      if (data.ok === true) {
        onValid(trimmed)
        return
      }
      setError("That invite code isn't valid (or has already been used).")
    } catch {
      setError('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 w-full text-left">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Got an invite?</h2>
        <p className="text-xs text-muted-foreground">
          Forum signup is invite-only. Paste the code an admin gave you.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-code">Invite code</Label>
        <Input
          ref={inputRef}
          id="invite-code"
          name="code"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={pending}
          placeholder="paste your code"
          className="font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Checking…' : 'Continue'}
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

// ---------------------------------------------------------------------------
// Sign-Up step 2 — username + passkey ceremony (Phase D)
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

function NextStepView({
  isActive,
  inviteCode,
  onBack,
}: {
  isActive: boolean
  inviteCode: string
  onBack: () => void
}) {
  const [username, setUsername] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when this pane slides in.
  useEffect(() => {
    if (!isActive) return
    const t = setTimeout(() => inputRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [isActive])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = username.trim().toLowerCase()
    if (!USERNAME_RE.test(trimmed)) {
      setError(
        'Username must be 3–20 characters, start with a letter, and use only lowercase letters, digits, underscores, or hyphens.',
      )
      inputRef.current?.focus()
      return
    }

    setPending(true)
    setError(null)
    try {
      // 1. Ask the server for registration options. Validates username
      //    shape + availability + invite redeemability before we ever
      //    pop the passkey sheet.
      const startRes = await fetch('/api/forum/auth/signup/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: inviteCode, username: trimmed }),
      })
      const startData = (await startRes.json()) as
        | {
            ok: true
            options: Parameters<typeof startRegistration>[0]['optionsJSON']
            challengeToken: string
          }
        | { ok: false; reason?: string }
      if (!startData.ok) {
        if (startData.reason === 'username_taken') {
          setError('That username is already taken. Try another.')
        } else if (startData.reason === 'invalid_username') {
          setError(
            'Username must be 3–20 characters, start with a letter, and use only lowercase letters, digits, underscores, or hyphens.',
          )
        } else if (startData.reason === 'invalid_invite') {
          setError('Your invite is no longer valid. Go back and re-enter your code.')
        } else {
          setError("Couldn't start signup. Try again.")
        }
        return
      }

      // 2. Run the WebAuthn registration ceremony — browser prompts the
      //    user to enroll a passkey via the platform UI (Touch ID,
      //    Windows Hello, etc.).
      let attestation: Awaited<ReturnType<typeof startRegistration>>
      try {
        attestation = await startRegistration({ optionsJSON: startData.options })
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') {
          // User cancelled — silent.
          return
        }
        setError("Couldn't register a passkey on this device.")
        return
      }

      // 3. Hand the attestation back so the server can verify, create
      //    the user, redeem the invite, and mint the session.
      const finishRes = await fetch('/api/forum/auth/signup/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeToken: startData.challengeToken,
          attestation,
          code: inviteCode,
          username: trimmed,
        }),
      })
      const finishData = (await finishRes.json()) as
        | { ok: true; username: string }
        | { ok: false; reason?: string }
      if (!finishData.ok) {
        if (finishData.reason === 'username_taken') {
          setError('That username was just taken. Try another.')
        } else if (finishData.reason === 'invite_consumed') {
          setError('This invite was just used by someone else.')
        } else if (finishData.reason === 'expired_challenge') {
          setError('Signup timed out. Try again.')
        } else if (finishData.reason === 'invalid_invite') {
          setError('Your invite is no longer valid. Go back and re-enter your code.')
        } else {
          setError("Couldn't complete signup. Try again.")
        }
        return
      }

      toast.success(`Welcome, @${finishData.username}.`)
      // Reload so the server-rendered ForumGate picks up the new
      // session cookie and renders the un-gated forum content.
      window.location.reload()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 w-full text-left">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Create Username</h2>
        <p className="text-xs text-muted-foreground">
          Choose your forum username. Your device will then prompt you to enroll a passkey.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-username">Username</Label>
        <Input
          ref={inputRef}
          id="signup-username"
          name="username"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={pending}
          placeholder="alice"
          maxLength={20}
          className="font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />
        <p className="text-[11px] text-muted-foreground">
          3–20 characters, letter-leading. Lowercase letters, digits, underscore, hyphen.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Setting up…' : 'Create'}
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
