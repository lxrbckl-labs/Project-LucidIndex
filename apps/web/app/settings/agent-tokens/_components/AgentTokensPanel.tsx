'use client'

/**
 * Client component that owns all interactivity for the Agent Tokens panel.
 * Rebuilt on shadcn primitives (Phase 2).
 *
 * Modes / states:
 *   - List view  — Table of tokens with Revoke action on non-revoked rows.
 *   - Issue modal — Dialog: label input → POST → display-once cleartext
 *     with copy affordance + "save now" warning → close.
 *   - Revoke confirm — AlertDialog before destructive action.
 *
 * Cleartext token lifecycle:
 *   1. POST /api/settings/agent-tokens  → { ok: true, token, row }
 *   2. Stored in React state for display ONLY. Never leaves the browser tab.
 *   3. User closes the Alert → state is cleared. Token is gone.
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
  const [issueOpen, setIssueOpen] = useState(false)
  // cleartext shown once after successful issue
  const [issuedToken, setIssuedToken] = useState<string | null>(null)

  function handleIssued(token: string) {
    setIssuedToken(token)
    setIssueOpen(false)
    router.refresh()
  }

  function handleDismissToken() {
    setIssuedToken(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tokens issued to headless agents. Each token is shown in plaintext exactly once at
            creation. Revoke a token to disable it — revoked tokens are kept for audit purposes.
          </p>
        </div>
        <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
          <DialogTrigger asChild>
            <Button>Issue new token</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <IssueModalContent onIssued={handleIssued} onClose={() => setIssueOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Display-once cleartext banner */}
      {issuedToken && <DisplayOnceToken token={issuedToken} onDismiss={handleDismissToken} />}

      {initialTokens.length === 0 ? (
        <EmptyState onIssue={() => setIssueOpen(true)} />
      ) : (
        <TokensTable rows={initialTokens} onRevoked={() => router.refresh()} />
      )}
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
      toast.success('Token copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable in some test envs — show a fallback.
    }
  }

  return (
    <Alert className="border-amber-400 bg-amber-50" role="alert" aria-live="assertive">
      <AlertTitle className="text-amber-900">
        Save this token now — it will not be shown again.
      </AlertTitle>
      <AlertDescription className="text-amber-800">
        <p className="text-xs mb-4">
          Copy it to your agent&apos;s configuration. Once you close this notice it is gone.
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <code
            className="font-mono text-sm break-all bg-white border border-amber-300 px-3 py-2 flex-1 rounded"
            data-testid="display-once-token"
          >
            {token}
          </code>
          <Button type="button" variant="secondary" size="sm" onClick={copy} className="shrink-0">
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </Button>
        </div>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onDismiss}
          className="mt-2 h-auto p-0 text-xs text-amber-700 underline hover:opacity-70"
        >
          I&apos;ve saved it — dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onIssue }: { onIssue: () => void }) {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <CardTitle>No agent tokens yet</CardTitle>
      </CardHeader>
      <CardContent className="pb-6 text-center">
        <p className="text-sm text-muted-foreground">
          Tokens are shown in plaintext exactly once at creation.
        </p>
      </CardContent>
      <CardFooter className="justify-center pb-8">
        <Button type="button" onClick={onIssue}>
          Issue your first token
        </Button>
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Token table
// ---------------------------------------------------------------------------

function TokensTable({ rows, onRevoked }: { rows: TokenRowClient[]; onRevoked: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Issued tokens</CardTitle>
        <CardDescription>
          Active tokens are used by agents at call time. Revoking is immediate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Hash prefix</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TokenRow key={row.id} row={row} onRevoked={onRevoked} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function TokenRow({ row, onRevoked }: { row: TokenRowClient; onRevoked: () => void }) {
  const revokedAt = row.revokedAt

  return (
    <TableRow>
      <TableCell className="font-semibold">{row.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.tokenHash.slice(0, 20)}…
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
      </TableCell>
      <TableCell>
        {revokedAt !== null ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
              aria-hidden="true"
            />
            Revoked{' '}
            <span className="text-muted-foreground/70">
              {new Date(revokedAt).toISOString().replace('T', ' ').slice(0, 16)}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Active
          </span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {revokedAt === null && <RevokeButton id={row.id} label={row.label} onRevoked={onRevoked} />}
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Revoke button with AlertDialog confirm
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

  async function handleRevoke() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/agent-tokens/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      })
      if (!res.ok) {
        toast.error('Revoke failed.')
        return
      }
      toast.success(`Token "${label}" revoked.`)
      onRevoked()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={pending}>
          {pending ? '…' : 'Revoke'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke token &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will immediately invalidate it for any agent using it. The token record is kept for
            audit purposes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Issue modal content (rendered inside DialogContent)
// ---------------------------------------------------------------------------

function IssueModalContent({
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

  // Focus the label input when the modal mounts.
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
    <>
      <DialogHeader>
        <DialogTitle>Issue new token</DialogTitle>
        <DialogDescription>
          The token is shown exactly once. Copy it immediately — it cannot be retrieved later.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="token-label">
            Label <span className="font-normal text-muted-foreground">(≤ 100 chars)</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Also used as the agent byline on article pages: <em>Analysis by &lt;label&gt;</em>.
          </p>
          <Input
            ref={inputRef}
            id="token-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            required
            placeholder="e.g. LucidIndex Crawler v1"
          />
          <p className="text-xs text-muted-foreground text-right">{label.length}/100</p>
        </div>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Issuing…' : 'Issue token'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
