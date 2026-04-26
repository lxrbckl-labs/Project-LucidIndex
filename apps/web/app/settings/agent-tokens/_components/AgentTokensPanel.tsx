'use client'

/**
 * Client component that owns all interactivity for the Agent Tokens panel.
 *
 * Modes / states:
 *   - List view  — table of tokens with Revoke action on non-revoked rows.
 *   - Issue modal — "Issue new token" form: label input → POST → display-once
 *     cleartext with copy affordance + "save now" warning → close.
 *
 * The RSC page (page.tsx) is the data owner — it loads the initial list from
 * the DB and passes it in as `initialTokens`. Mutations call `router.refresh()`
 * so Next re-runs the RSC and pipes fresh data back into this component.
 *
 * Cleartext token lifecycle:
 *   1. POST /api/settings/agent-tokens  → { ok: true, token, row }
 *   2. Stored in React state for display ONLY. Never leaves the browser tab.
 *   3. User closes the modal → state is cleared. Token is gone.
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

// Mirror of AgentTokenRow (dates serialized to ISO strings by JSON.stringify).
export type TokenRowClient = {
  id: string
  label: string
  tokenHash: string
  createdAt: string
  revokedAt: string | null
}

type Props = { initialTokens: TokenRowClient[] }

export function AgentTokensPanel({ initialTokens }: Props) {
  const router = useRouter()
  const [showIssueModal, setShowIssueModal] = useState(false)
  // cleartext shown once after successful issue
  const [issuedToken, setIssuedToken] = useState<string | null>(null)

  function handleIssued(token: string) {
    setIssuedToken(token)
    setShowIssueModal(false)
    router.refresh()
  }

  function handleModalClose() {
    setShowIssueModal(false)
  }

  function handleDismissToken() {
    setIssuedToken(null)
  }

  return (
    <div className="max-w-[960px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <div className="flex items-baseline justify-between gap-4">
        <h1
          className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          Agent tokens
        </h1>
        <button
          type="button"
          onClick={() => setShowIssueModal(true)}
          className="shrink-0 inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
        >
          Issue new token
        </button>
      </div>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />
      <p className="text-sm text-neutral-600 leading-relaxed mb-8">
        Tokens issued to headless agents. Each token is shown in plaintext exactly once at creation.
        Revoke a token to disable it — revoked tokens are kept for audit purposes. Agent bylines on
        articles use the token&apos;s <code className="font-mono text-xs">label</code> field (
        <em>Analysis by &lt;label&gt;</em>).
      </p>

      {/* Display-once cleartext banner */}
      {issuedToken && <DisplayOnceToken token={issuedToken} onDismiss={handleDismissToken} />}

      {initialTokens.length === 0 ? (
        <EmptyState onIssue={() => setShowIssueModal(true)} />
      ) : (
        <TokensTable rows={initialTokens} onRevoked={() => router.refresh()} />
      )}

      {/* Issue modal */}
      {showIssueModal && <IssueModal onIssued={handleIssued} onClose={handleModalClose} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display-once cleartext banner
// ---------------------------------------------------------------------------

function DisplayOnceToken({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable in some test envs — show a fallback.
    }
  }

  return (
    <div
      className="mb-8 border border-amber-400 bg-amber-50 px-5 py-5"
      role="alert"
      aria-live="assertive"
    >
      <p className="text-sm font-semibold text-amber-900 mb-1">
        Save this token now — it will not be shown again.
      </p>
      <p className="text-xs text-amber-800 mb-4">
        Copy it to your agent&apos;s configuration. Once you close this notice it is gone.
      </p>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <code
          className="font-mono text-sm break-all bg-white border border-amber-300 px-3 py-2 flex-1"
          data-testid="display-once-token"
        >
          {token}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 bg-amber-800 text-white text-xs font-semibold px-4 py-2 hover:opacity-80"
        >
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 text-xs text-amber-700 underline hover:opacity-70"
      >
        I&apos;ve saved it — dismiss
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onIssue }: { onIssue: () => void }) {
  return (
    <div className="border border-dashed border-neutral-300 px-6 py-12 text-center">
      <p className="text-sm text-neutral-600 mb-4">No agent tokens yet.</p>
      <button
        type="button"
        onClick={onIssue}
        className="inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
      >
        Issue your first token
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Token table
// ---------------------------------------------------------------------------

function TokensTable({ rows, onRevoked }: { rows: TokenRowClient[]; onRevoked: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <Th>Label</Th>
            <Th>Hash prefix</Th>
            <Th>Issued</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TokenRow key={row.id} row={row} onRevoked={onRevoked} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TokenRow({ row, onRevoked }: { row: TokenRowClient; onRevoked: () => void }) {
  const revokedAt = row.revokedAt

  return (
    <tr className="border-b border-neutral-200 align-middle">
      <Td className="font-semibold">{row.label}</Td>
      <Td className="font-mono text-xs text-neutral-500">{row.tokenHash.slice(0, 20)}…</Td>
      <Td className="text-xs text-neutral-600">
        {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
      </Td>
      <Td>
        {revokedAt !== null ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="inline-block w-2 h-2 rounded-full bg-neutral-300" aria-hidden="true" />
            Revoked{' '}
            <span className="text-neutral-400">
              {new Date(revokedAt).toISOString().replace('T', ' ').slice(0, 16)}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Active
          </span>
        )}
      </Td>
      <Td className="text-right whitespace-nowrap">
        {revokedAt === null && <RevokeButton id={row.id} label={row.label} onRevoked={onRevoked} />}
      </Td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Revoke button
// ---------------------------------------------------------------------------

function RevokeButton({
  id,
  label,
  onRevoked,
}: {
  id: string
  label: string
  onRevoked: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    if (
      !window.confirm(
        `Revoke token "${label}"? This will immediately invalidate it for any agent using it.`,
      )
    ) {
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/settings/agent-tokens/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      })
      if (!res.ok) {
        setError('Revoke failed.')
        return
      }
      onRevoked()
    } catch {
      setError('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        className="text-sm font-semibold underline text-red-700 hover:opacity-70 disabled:opacity-40"
      >
        {pending ? '…' : 'Revoke'}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Issue modal
// ---------------------------------------------------------------------------

function IssueModal({
  onIssued,
  onClose,
}: {
  onIssued: (token: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the label input when the modal mounts — replaces autoFocus to
  // satisfy the biome/a11y/noAutofocus lint rule.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Label is required.')
      inputRef.current?.focus()
      return
    }
    if (trimmed.length > 100) {
      setError('Label must be 100 characters or fewer.')
      inputRef.current?.focus()
      return
    }

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/agent-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      })
      const data = (await res.json()) as { ok: true; token: string } | { ok: false; error?: string }
      if (!res.ok || !data.ok) {
        setError(
          data.ok === false ? (data.error ?? 'Failed to issue token.') : 'Failed to issue token.',
        )
        return
      }
      // data.token is the cleartext — handed to parent for display-once
      onIssued(data.token)
    } catch {
      setError('Network error — token was not issued.')
    } finally {
      setPending(false)
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="bg-white w-full max-w-md mx-4 p-8 border border-black">
        <h2 id="issue-modal-title" className="text-xl font-black uppercase tracking-tight mb-6">
          Issue new token
        </h2>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="token-label" className="block text-sm font-semibold mb-1">
            Label <span className="font-normal text-neutral-500">(≤ 100 chars)</span>
          </label>
          <p className="text-xs text-neutral-500 mb-3">
            Also used as the agent byline on article pages: <em>Analysis by &lt;label&gt;</em>.
          </p>
          <input
            ref={inputRef}
            id="token-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            required
            placeholder="e.g. LucidIndex Crawler v1"
            className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-black mb-1"
          />
          <p className="text-xs text-neutral-400 mb-4 text-right">{label.length}/100</p>

          {error && (
            <p className="text-xs text-red-600 mb-4" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="text-sm font-semibold underline hover:opacity-70 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-black text-white text-sm font-semibold px-5 py-2 hover:opacity-80 disabled:opacity-40"
            >
              {pending ? 'Issuing…' : 'Issue token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 font-semibold ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 ${className}`}>{children}</td>
}
