'use client'

/**
 * FoundingGate — claim the first admin, in the swipe-card dialog style.
 *
 * Mirrors SettingsAuthGate / ForumGate: a centered card with a translateX
 * slide-track and two panes:
 *   0 — Token:  verify the founding token.
 *   1 — Create: name + passkey enrollment, then a one-time passcode modal.
 *
 * Wires the three founding API routes (/api/auth/founding/{start,finish,
 * finalize}) and the server-side token check. The passcode is shown once in a
 * Dialog before the session is minted (setting the cookie mid-render would
 * unmount the form before the user reads the code).
 */

import { startRegistration } from '@simplewebauthn/browser'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, forwardRef, type ReactNode, useEffect, useRef, useState } from 'react'
import { verifyFoundingToken } from '@/app/settings/found/actions'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEFAULT_DEVICE_LABEL = 'Founding device'
const GENERIC_FAILURE = "Couldn't claim founding admin — try again"

type Mode = 'token' | 'create'

export function FoundingGate() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('token')
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)
  const index = mode === 'token' ? 0 : 1

  const tokenRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = mode === 'token' ? tokenRef.current : createRef.current
    if (!node) return
    const update = () => setTrackHeight(node.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

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
          <Pane ref={tokenRef} active={mode === 'token'}>
            <TokenPane
              onVerified={(token) => {
                setVerifiedToken(token)
                setMode('create')
              }}
            />
          </Pane>
          <Pane ref={createRef} active={mode === 'create'}>
            <CreatePane
              isActive={mode === 'create'}
              verifiedToken={verifiedToken}
              onBack={() => setMode('token')}
              onSuccess={() => {
                router.replace('/settings')
                router.refresh()
              }}
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

function TokenPane({ onVerified }: { onVerified: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const candidate = token.trim()
    if (!candidate) {
      setError('Enter your founding token.')
      inputRef.current?.focus()
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await verifyFoundingToken(candidate)
      if (res.ok) {
        onVerified(candidate)
        return
      }
      setError('Token is incorrect. Double-check and try again.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 w-full text-left">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Claim Admin</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          No admin yet. Enter your founding token to take ownership of this LucidIndex.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="founding-token">Founding token</Label>
        <Input
          ref={inputRef}
          id="founding-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={pending}
          placeholder="Paste your founding token"
          data-testid="founding-token-input"
          className="font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={pending}
          data-testid="founding-token-submit"
          className="w-full"
        >
          {pending ? 'Verifying…' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}

function CreatePane({
  isActive,
  verifiedToken,
  onBack,
  onSuccess,
}: {
  isActive: boolean
  verifiedToken: string | null
  onBack: () => void
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [stage, setStage] = useState<'idle' | 'working' | 'recovery-modal' | 'finalizing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [pending, setPending] = useState<{ adminId: string; credentialId: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isActive) return
    const t = setTimeout(() => inputRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [isActive])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage !== 'idle') return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter your name.')
      inputRef.current?.focus()
      return
    }
    setError(null)
    setStage('working')
    try {
      const startRes = await fetch('/api/auth/founding/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceLabel: DEFAULT_DEVICE_LABEL }),
      })
      const start = (await startRes.json()) as
        | {
            ok: true
            options: Parameters<typeof startRegistration>[0]['optionsJSON']
            challengeToken: string
          }
        | { ok: false }
      if (!start.ok) {
        setError(GENERIC_FAILURE)
        setStage('idle')
        return
      }
      let attestation: Awaited<ReturnType<typeof startRegistration>>
      try {
        attestation = await startRegistration({ optionsJSON: start.options })
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setStage('idle')
          return
        }
        setError("Couldn't enroll a passkey on this device.")
        setStage('idle')
        return
      }
      const finishRes = await fetch('/api/auth/founding/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeToken: start.challengeToken,
          name: trimmed,
          deviceLabel: DEFAULT_DEVICE_LABEL,
          attestation,
          foundingToken: verifiedToken,
        }),
      })
      const finish = (await finishRes.json()) as
        | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
        | { ok: false }
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

  async function handleDismiss() {
    if (!pending) return
    setStage('finalizing')
    setError(null)
    try {
      const res = await fetch('/api/auth/founding/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pending),
      })
      const data = (await res.json()) as { ok: true } | { ok: false }
      if (!data.ok) {
        setError(GENERIC_FAILURE)
        setStage('recovery-modal')
        return
      }
      onSuccess()
    } catch {
      setError(GENERIC_FAILURE)
      setStage('recovery-modal')
    }
  }

  const modalOpen = (stage === 'recovery-modal' || stage === 'finalizing') && !!recoveryCode

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 w-full text-left">
        <div className="flex flex-col gap-2 text-center">
          <h2 className="text-xl font-semibold tracking-tight">Create Account</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose your name, then enroll a passkey on this device.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="founding-name">Your name</Label>
          <Input
            ref={inputRef}
            id="founding-name"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={stage !== 'idle'}
            placeholder="Alex"
            data-testid="founding-name"
          />
        </div>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            disabled={stage !== 'idle'}
            data-testid="founding-submit"
            className="w-full"
          >
            {stage === 'working' ? 'Enrolling…' : 'Claim Admin'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={stage !== 'idle'}
            className="w-full"
          >
            <ArrowLeft className="h-6 w-6 mr-2" />
            Back
          </Button>
        </div>
      </form>

      {/* One-time passcode — stays mounted until the session is finalized. */}
      <Dialog open={modalOpen} onOpenChange={() => {}}>
        <DialogContent
          data-testid="recovery-modal"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Save your passcode</DialogTitle>
            <DialogDescription>
              This passcode is shown once. Store it somewhere safe — it's how you sign in if you
              lose your passkey.
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
              onClick={handleDismiss}
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
