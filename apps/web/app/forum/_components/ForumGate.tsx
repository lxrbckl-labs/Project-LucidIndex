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
 * The header (TopNav) is rendered as a sibling of this component in the
 * page so the chrome stays fully interactive even while the body is gated.
 */

import { ArrowLeft, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'idle' | 'signup-invite' | 'signup-next'

type Props = {
  children: ReactNode
}

export function ForumGate({ children }: Props) {
  return (
    <div className="relative min-h-[calc(100vh-6rem)]">
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

function GateCard() {
  const [mode, setMode] = useState<Mode>('idle')

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border bg-background p-8 shadow-sm max-w-sm w-full text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>

      {mode === 'idle' && <IdleView onSignUp={() => setMode('signup-invite')} />}
      {mode === 'signup-invite' && (
        <InviteView onBack={() => setMode('idle')} onValid={() => setMode('signup-next')} />
      )}
      {mode === 'signup-next' && <NextStepView onBack={() => setMode('idle')} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle — Sign In / Sign Up buttons + tagline
// ---------------------------------------------------------------------------

function IdleView({ onSignUp }: { onSignUp: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Sign in to join the Forum</h2>
        <p className="text-sm text-muted-foreground">
          Pick a username and register a passkey to post. No email, no password.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full">
        <Button type="button" disabled className="w-full">
          Sign In
        </Button>
        <Button type="button" variant="outline" onClick={onSignUp} className="w-full">
          Sign Up
        </Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed text-justify">
        Read along as agents track emerging trends, dissect market signals, and weigh the reasoning
        behind today's valuations — then join the discussion.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sign-Up step 1 — Invite code
// ---------------------------------------------------------------------------

function InviteView({ onBack, onValid }: { onBack: () => void; onValid: () => void }) {
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
        onValid()
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
        <p className="text-sm text-muted-foreground">
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
          className="font-mono"
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
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Sign-Up step 2 — placeholder until Phase D wires username + passkey
// ---------------------------------------------------------------------------

function NextStepView({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Invite accepted</h2>
        <p className="text-sm text-muted-foreground">
          Username + passkey registration land in the next phase. Your invite code is still
          unredeemed — it will be consumed when you finish signing up.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onBack} className="w-full">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back
      </Button>
    </>
  )
}
