'use client'

/**
 * "Regenerate recovery code" client component — shadcn/ui rebuild (Phase 1).
 *
 * Fires a POST to /api/settings/account/recovery-code, then displays the
 * plaintext code ONCE in a shadcn Dialog with a "Copy to clipboard"
 * affordance and a clear "Save this now" warning. After the user dismisses,
 * the code is gone from the UI forever.
 */

import { useState } from 'react'
import { toast } from 'sonner'

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
  const [error, setError] = useState<string | null>(null)

  async function handleRegenerate() {
    if (stage === 'working') return
    setError(null)
    setCode(null)
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
      // Copy is the only dismiss affordance — copy, close immediately, and
      // confirm via toast (the code is gone from the UI the moment we close).
      handleDismiss()
      toast.success('Recovery code copied to clipboard.')
    } catch {
      // Clipboard unavailable — keep the dialog open so the code can still be
      // selected/copied by hand.
      toast.error("Couldn't copy — select the code and copy it manually.")
    }
  }

  function handleDismiss() {
    setCode(null)
    setStage('idle')
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
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Copying closes this dialog and the code won't be shown again — make sure it lands
              somewhere safe before you copy.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
