'use client'

/**
 * FoundingGate — claim the first admin ("Generate token" flow).
 *
 * Mirrors the swipe-card dialog style with two panes:
 *   0 — Claim: a single "Generate token" button. POSTs /api/auth/founding/claim,
 *       which creates the admin + a reusable passcode (lipc_) and signs you in.
 *   1 — Setup: shows the passcode once (save it — your backup sign-in), then
 *       offers to enroll a passkey (the authenticated register flow) as your
 *       primary sign-in. Either button lands you in /settings.
 *
 * No founding-token input and no .env: founding is open only while the admins
 * table is empty, and the first claim wins (enforced server-side).
 */

import { startRegistration } from '@simplewebauthn/browser'
import { useRouter } from 'next/navigation'
import { forwardRef, type ReactNode, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const DEVICE_LABEL = 'Founding device'
const GENERIC_FAILURE = "Couldn't claim admin — try again."

type Mode = 'claim' | 'setup'

export function FoundingGate() {
  const [mode, setMode] = useState<Mode>('claim')
  const [passcode, setPasscode] = useState<string | null>(null)
  const index = mode === 'claim' ? 0 : 1

  const claimRef = useRef<HTMLDivElement>(null)
  const setupRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = mode === 'claim' ? claimRef.current : setupRef.current
    if (!node) return
    const update = () => setTrackHeight(node.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 rounded-xl border bg-background p-6 text-center shadow-sm">
      <div
        className="w-full overflow-hidden transition-[height] duration-300 ease-out"
        style={trackHeight !== undefined ? { height: trackHeight } : undefined}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <Pane ref={claimRef} active={mode === 'claim'}>
            <ClaimPane
              onClaimed={(code) => {
                setPasscode(code)
                setMode('setup')
              }}
            />
          </Pane>
          <Pane ref={setupRef} active={mode === 'setup'}>
            <SetupPane passcode={passcode} />
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
// Pane 0 — Generate the admin token (claims the admin + signs you in)
// ---------------------------------------------------------------------------

function ClaimPane({ onClaimed }: { onClaimed: (passcode: string) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/founding/claim', { method: 'POST' })
      const data = (await res.json()) as
        | { ok: true; passcode: string }
        | { ok: false; reason?: string }
      if (data.ok) {
        onClaimed(data.passcode)
        return
      }
      setError(
        data.reason === 'not_available' ? 'This LucidIndex already has an admin.' : GENERIC_FAILURE,
      )
    } catch {
      setError(GENERIC_FAILURE)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Claim Admin</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          No admin yet. Generate your sign-in token to take ownership of this LucidIndex.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        onClick={generate}
        disabled={pending}
        data-testid="founding-generate"
        className="w-full"
      >
        {pending ? 'Generating…' : 'Generate token'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pane 1 — Save the token, then (optionally) enroll a passkey
// ---------------------------------------------------------------------------

function SetupPane({ passcode }: { passcode: string | null }) {
  const router = useRouter()
  const [stage, setStage] = useState<'idle' | 'enrolling'>('idle')
  const [error, setError] = useState<string | null>(null)

  function finish() {
    // The claim already minted the session; land on the authenticated hub.
    router.replace('/settings')
    router.refresh()
  }

  async function enrollPasskey() {
    if (stage !== 'idle') return
    setStage('enrolling')
    setError(null)
    try {
      const startRes = await fetch('/api/auth/passkey/register/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceLabel: DEVICE_LABEL }),
      })
      const start = (await startRes.json()) as
        | {
            ok: true
            options: Parameters<typeof startRegistration>[0]['optionsJSON']
            challengeToken: string
          }
        | { ok: false }
      if (!start.ok) {
        setError("Couldn't start passkey enrollment.")
        setStage('idle')
        return
      }

      let attestation: Awaited<ReturnType<typeof startRegistration>>
      try {
        attestation = await startRegistration({ optionsJSON: start.options })
      } catch (err) {
        // Cancelled the platform sheet — silently return to the pane.
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setStage('idle')
          return
        }
        setError("Couldn't enroll a passkey on this device.")
        setStage('idle')
        return
      }

      const finishRes = await fetch('/api/auth/passkey/register/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeToken: start.challengeToken,
          deviceLabel: DEVICE_LABEL,
          attestation,
        }),
      })
      const data = (await finishRes.json()) as { ok: true } | { ok: false }
      if (!data.ok) {
        setError("Couldn't finish passkey enrollment.")
        setStage('idle')
        return
      }
      finish()
    } catch {
      setError("Couldn't enroll a passkey on this device.")
      setStage('idle')
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Save your token</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Shown once. Store it somewhere safe — it's your backup sign-in if you lose your passkey.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="founding-passcode">Sign-in token</Label>
        <pre
          id="founding-passcode"
          className="select-all break-all rounded-md bg-muted px-4 py-3 text-left font-mono text-sm tracking-tight"
          data-testid="founding-passcode"
        >
          {passcode}
        </pre>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={enrollPasskey}
          disabled={stage !== 'idle'}
          data-testid="founding-enroll-passkey"
          className="w-full"
        >
          {stage === 'enrolling' ? 'Enrolling…' : 'Enroll a passkey'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={finish}
          disabled={stage !== 'idle'}
          data-testid="founding-skip"
          className="w-full"
        >
          I've saved it — finish
        </Button>
      </div>
    </div>
  )
}
