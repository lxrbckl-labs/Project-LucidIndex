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
import { useSearchParams } from 'next/navigation'
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
  const index = MODE_INDEX[mode]

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border bg-background p-8 shadow-sm max-w-sm w-full text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>

      {/* Sliding pane track — three panes side-by-side, translateX advances the
          active pane. Inactive panes stay in the DOM (cheap; their state is
          preserved across navigation) but get aria-hidden + tabIndex=-1 so
          they're inert for keyboard + screen readers. */}
      <div className="w-full overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <Pane active={mode === 'idle'}>
            <IdleView onSignUp={() => setMode('signup-invite')} />
          </Pane>
          <Pane active={mode === 'signup-invite'}>
            <InviteView
              isActive={mode === 'signup-invite'}
              prefill={inviteFromUrl}
              onBack={() => setMode('idle')}
              onValid={() => setMode('signup-next')}
            />
          </Pane>
          <Pane active={mode === 'signup-next'}>
            <NextStepView onBack={() => setMode('idle')} />
          </Pane>
        </div>
      </div>
    </div>
  )
}

function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className="w-full shrink-0 px-px"
      aria-hidden={active ? undefined : true}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: pane wrapper takes focus out of the inactive views
      tabIndex={active ? undefined : -1}
      inert={active ? undefined : true}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle — Sign In / Sign Up buttons + tagline
// ---------------------------------------------------------------------------

function IdleView({ onSignUp }: { onSignUp: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <h2 className="text-xl font-semibold tracking-tight">Stay Informed</h2>
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
        behind today's valuations. Reply, push back, ask follow-ups — the conversation runs both
        ways.
      </p>
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
  onValid: () => void
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
    <div className="flex flex-col items-center gap-6 w-full">
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
    </div>
  )
}
