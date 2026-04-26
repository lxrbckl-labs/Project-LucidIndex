'use client'

/**
 * "Regenerate recovery code" client component.
 *
 * Fires a POST to /api/settings/account/recovery-code, then displays the
 * plaintext code ONCE with a "Copy to clipboard" affordance and a clear
 * "Save this now" warning. After the user navigates away the code is gone
 * from the UI forever (the server only returns it on the generate call).
 */

import { useState } from 'react'

type Stage = 'idle' | 'working' | 'showing'

export function RegenerateRecoveryCode() {
  const [stage, setStage] = useState<Stage>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    } catch {
      // Clipboard API unavailable (non-HTTPS, old browser) — silently no-op.
    }
  }

  function handleDismiss() {
    setCode(null)
    setStage('idle')
    setCopied(false)
  }

  return (
    <div className="flex flex-col gap-4" data-testid="regenerate-recovery-code">
      <p className="text-sm text-neutral-600 leading-relaxed max-w-prose">
        If you lose all your passkeys, the recovery code is the only path back. Generate a new code
        if you suspect the old one is compromised.{' '}
        <strong className="text-black">
          Each regeneration immediately burns the previous code.
        </strong>
      </p>

      {stage !== 'showing' && (
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={stage === 'working'}
          className="self-start px-4 py-2 text-sm font-medium border border-neutral-300 rounded hover:border-black hover:text-black text-neutral-700 disabled:opacity-50"
          data-testid="regenerate-recovery-button"
        >
          {stage === 'working' ? 'Generating…' : 'Regenerate recovery code'}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600" data-testid="regenerate-recovery-error">
          {error}
        </p>
      )}

      {stage === 'showing' && code && (
        <div
          role="alert"
          className="border border-amber-400 bg-amber-50 rounded p-4 flex flex-col gap-3"
          data-testid="recovery-code-display"
        >
          <p className="text-sm font-semibold text-amber-900">
            Save this recovery code now — it will not be shown again.
          </p>
          <p className="text-xs text-amber-800 leading-relaxed">
            Store it somewhere safe and offline: a password manager, printed paper, or an encrypted
            note. Once you dismiss this panel, there is no way to retrieve this code.
          </p>
          <div className="flex items-center gap-3">
            <code
              className="flex-1 font-mono text-lg tracking-[0.15em] text-black bg-white border border-neutral-200 rounded px-3 py-2 select-all"
              data-testid="recovery-code-value"
            >
              {code}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 text-sm font-medium border border-neutral-300 rounded hover:border-black text-neutral-700 shrink-0"
              data-testid="recovery-code-copy"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="self-start px-4 py-2 text-sm font-medium bg-black text-white rounded hover:opacity-80"
            data-testid="recovery-code-dismiss"
          >
            I've saved it — dismiss
          </button>
        </div>
      )}
    </div>
  )
}
