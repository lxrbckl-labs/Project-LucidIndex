'use client'

/**
 * "Regenerate recovery code" client component — shadcn/ui rebuild (Phase 1).
 *
 * Fires a POST to /api/settings/account/recovery-code, then displays the
 * plaintext code ONCE in a shadcn Dialog with a "Copy to clipboard"
 * affordance and a clear "Save this now" warning. After the user dismisses,
 * the code is gone from the UI forever.
 */

import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Stage = 'idle' | 'working' | 'showing'

export function RegenerateRecoveryCode() {
  const [stage, setStage] = useState<Stage>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending auto-close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  async function handleRegenerate() {
    if (stage === 'working') return
    setError(null)
    setCode(null)
    setCopied(false)
    setStage('working')

    try {
      const res = await fetch('/api/settings/account/recovery-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const data = (await res.json()) as { ok: true; recoveryCode: string } | { ok: false }
      if (!data.ok) {
        setError("Couldn't regenerate recovery code — try again.")
        setStage('idle')
        return
      }
      setCode(data.recoveryCode)
      setStage('showing')
    } catch {
      setError("Couldn't regenerate recovery code — try again.")
      setStage('idle')
    }
  }

  async function handleCopy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      // Copy is now the only dismiss affordance — auto-close after 3s so the
      // admin has a beat to see "Copied!" before the code disappears.
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = setTimeout(handleDismiss, 3000)
    } catch {
      // Clipboard API unavailable — silently no-op.
    }
  }

  function handleDismiss() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setCode(null)
    setStage('idle')
    setCopied(false)
  }

  return (
    <div className="flex flex-col gap-4" data-testid="regenerate-recovery-code">
      <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
        If you lose all your passkeys, the recovery code is the only path back. Generate a new code
        if you suspect the old one is compromised.{' '}
        <strong className="text-foreground">
          Each regeneration immediately burns the previous code.
        </strong>
      </p>

      <Button
        size="sm"
        type="button"
        variant="outline"
        onClick={handleRegenerate}
        disabled={stage === 'working'}
        className="self-start"
        data-testid="regenerate-recovery-button"
      >
        {stage === 'working' ? 'Generating…' : 'Regenerate recovery code'}
      </Button>

      {error && (
        <Alert variant="destructive" data-testid="regenerate-recovery-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Recovery code dialog — one-time display */}
      <Dialog
        open={stage === 'showing' && !!code}
        onOpenChange={(open) => {
          if (!open) handleDismiss()
        }}
      >
        <DialogContent
          data-testid="recovery-code-display"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Save your recovery code</DialogTitle>
            <DialogDescription>
              This code will not be shown again. Store it somewhere safe — a password manager,
              printed paper, or an encrypted note.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <code
              className="w-full break-all font-mono text-sm sm:text-base tracking-[0.1em] rounded-md bg-muted px-3 py-2 select-all"
              data-testid="recovery-code-value"
            >
              {code}
            </code>
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={handleCopy} data-testid="recovery-code-copy">
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
