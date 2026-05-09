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

import { Copy } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
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
    <div className="flex flex-col gap-8">
      <div className="-mx-6 px-6 pb-6 border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tokens issued to headless agents. Each token is shown in plaintext exactly once at
            creation. Revoke a token to disable it — revoked tokens are kept for audit purposes.
          </p>
        </div>
        <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
          <DialogTrigger asChild>
            <Button>New Token</Button>
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
      toast.success('Token copied to clipboard', {
        description:
          "Paste it into your agent's configuration (e.g. MCP_AGENT_TOKEN). Save it somewhere safe — it will not be shown again.",
        duration: 8000,
      })
      // Brief pause so the user sees the "Copied" state before the alert fades.
      setTimeout(onDismiss, 800)
    } catch {
      // Clipboard API unavailable in some test envs — leave the card up.
    }
  }

  return (
    <Alert className="border-amber-400 bg-amber-50" role="alert" aria-live="assertive">
      <AlertTitle className="text-amber-900">
        Save this token now — it will not be shown again.
      </AlertTitle>
      <AlertDescription className="text-amber-800">
        <p className="text-xs mb-4">
          Copy it to your agent&apos;s configuration. This card disappears once you copy.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={copy}
            disabled={copied}
            aria-label={copied ? 'Copied' : 'Copy token to clipboard'}
            className="h-10 w-10 shrink-0 border border-amber-300 bg-background hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <code
            className="font-mono text-sm break-all bg-background border border-amber-300 px-3 py-2 flex-1 rounded"
            data-testid="display-once-token"
          >
            {token}
          </code>
        </div>
      </AlertDescription>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onIssue }: { onIssue: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">No agent tokens yet</h2>
      <p className="max-w-[420px] text-sm text-muted-foreground">
        Tokens are shown in plaintext exactly once at creation.
      </p>
      <Button type="button" onClick={onIssue}>
        New Token
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Token table
// ---------------------------------------------------------------------------

function TokensTable({ rows, onRevoked }: { rows: TokenRowClient[]; onRevoked: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Issued tokens</h2>
        <p className="text-sm text-muted-foreground">
          Active tokens are used by agents at call time. Revoking is immediate.
        </p>
      </div>
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
    </section>
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
          <Badge variant="outline" className="text-muted-foreground">
            Revoked
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-emerald-600">
            Active
          </Badge>
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
        <DialogTitle>New Token</DialogTitle>
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

        <DialogFooter className="sm:justify-between">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
