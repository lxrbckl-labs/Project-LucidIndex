'use client'

/**
 * Settings → Forum Invites client panel. Mirrors AgentTokensPanel:
 *   - List view → Table of invites with status (available/redeemed/expired)
 *   - Issue modal → label + optional expiry-days input → POST → display-once card
 *
 * Cleartext invite code lifecycle:
 *   1. POST /api/settings/forum-invites → { ok: true, code, row }
 *   2. Stored in React state for display ONLY. Never leaves the browser tab.
 *   3. Copy → toast → state cleared after a brief pause.
 */

import { Copy } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

export type InviteRowClient = {
  id: string
  label: string
  codeHash: string
  createdAt: string
  expiresAt: string | null
  redeemedAt: string | null
  redeemedByUserId: string | null
}

type Props = { initialInvites: InviteRowClient[] }

type Status = 'available' | 'redeemed' | 'expired'

function deriveStatus(row: InviteRowClient): Status {
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'available'
}

export function ForumInvitesPanel({ initialInvites }: Props) {
  const router = useRouter()
  const [issueOpen, setIssueOpen] = useState(false)
  const [issuedCode, setIssuedCode] = useState<string | null>(null)

  function handleIssued(code: string) {
    setIssuedCode(code)
    setIssueOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 px-6 pb-6 border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Forum Invites</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Single-use invite codes that gate forum signup. Each code is shown in plaintext exactly
            once at creation. Codes are kept for audit even after redemption or expiry.
          </p>
        </div>
        <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
          <DialogTrigger asChild>
            <Button>New Invite</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <IssueModalContent onIssued={handleIssued} onClose={() => setIssueOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {issuedCode && <DisplayOnceInvite code={issuedCode} onDismiss={() => setIssuedCode(null)} />}

      {initialInvites.length === 0 ? (
        <EmptyState onIssue={() => setIssueOpen(true)} />
      ) : (
        <InvitesTable rows={initialInvites} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display-once cleartext banner
// ---------------------------------------------------------------------------

function DisplayOnceInvite({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Invite code copied to clipboard', {
        description:
          'Send it to the person you want to invite. Save it somewhere safe — it will not be shown again.',
        duration: 8000,
      })
      setTimeout(onDismiss, 800)
    } catch {
      // Clipboard API unavailable in some test envs — leave the card up.
    }
  }

  return (
    <Alert className="border-amber-400 bg-amber-50" role="alert" aria-live="assertive">
      <AlertTitle className="text-amber-900">
        Save this code now — it will not be shown again.
      </AlertTitle>
      <AlertDescription className="text-amber-800">
        <p className="text-xs mb-4">Share it out-of-band. This card disappears once you copy.</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={copy}
            disabled={copied}
            aria-label={copied ? 'Copied' : 'Copy invite code to clipboard'}
            className="h-10 w-10 shrink-0 border border-amber-300 bg-background hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <code
            className="font-mono text-sm break-all bg-background border border-amber-300 px-3 py-2 flex-1 rounded"
            data-testid="display-once-invite"
          >
            {code}
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
      <h2 className="text-lg font-semibold tracking-tight">No invites yet</h2>
      <p className="max-w-[420px] text-sm text-muted-foreground">
        Generate one to admit the next forum user. Codes are shown in plaintext exactly once.
      </p>
      <Button type="button" onClick={onIssue}>
        New Invite
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invites table
// ---------------------------------------------------------------------------

function InvitesTable({ rows }: { rows: InviteRowClient[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Issued invites</h2>
        <p className="text-sm text-muted-foreground">
          Available codes can still be redeemed. Redeemed and expired codes are kept for audit.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Hash prefix</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <InviteRow key={row.id} row={row} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function InviteRow({ row }: { row: InviteRowClient }) {
  const status = deriveStatus(row)

  return (
    <TableRow>
      <TableCell className="font-semibold">{row.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.codeHash.slice(0, 20)}…
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.expiresAt ? new Date(row.expiresAt).toISOString().replace('T', ' ').slice(0, 16) : '—'}
      </TableCell>
      <TableCell>
        <StatusBadge status={status} redeemedAt={row.redeemedAt} expiresAt={row.expiresAt} />
      </TableCell>
    </TableRow>
  )
}

function StatusBadge({
  status,
  redeemedAt,
  expiresAt,
}: {
  status: Status
  redeemedAt: string | null
  expiresAt: string | null
}) {
  if (status === 'redeemed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
          aria-hidden="true"
        />
        Redeemed{' '}
        {redeemedAt && (
          <span className="text-muted-foreground/70">
            {new Date(redeemedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </span>
    )
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
          aria-hidden="true"
        />
        Expired{' '}
        {expiresAt && (
          <span className="text-muted-foreground/70">
            {new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
      Available
    </span>
  )
}

// ---------------------------------------------------------------------------
// Issue modal content
// ---------------------------------------------------------------------------

function IssueModalContent({
  onIssued,
  onClose,
}: {
  onIssued: (code: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [expiryDays, setExpiryDays] = useState<string>('30')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

    let expiresAt: string | null = null
    const trimmedDays = expiryDays.trim()
    if (trimmedDays !== '') {
      const n = Number(trimmedDays)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 3650) {
        setError('Expiry days must be a positive integer (1–3650), or blank for no expiry.')
        return
      }
      expiresAt = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
    }

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/forum-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmed, expiresAt }),
      })
      const data = (await res.json()) as { ok: true; code: string } | { ok: false; error?: string }
      if (!res.ok || !data.ok) {
        setError(
          data.ok === false ? (data.error ?? 'Failed to issue invite.') : 'Failed to issue invite.',
        )
        return
      }
      onIssued(data.code)
    } catch {
      setError('Network error — invite was not issued.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New Invite</DialogTitle>
        <DialogDescription>
          The code is shown exactly once. Copy it immediately — it cannot be retrieved later.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-label">
            Label <span className="font-normal text-muted-foreground">(≤ 100 chars)</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Visible to admin only. e.g. <em>for Alice</em>, <em>discord drop 2026-05</em>.
          </p>
          <Input
            ref={inputRef}
            id="invite-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            required
            placeholder="for Alice"
          />
          <p className="text-xs text-muted-foreground text-right">{label.length}/100</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-expiry">Expires in (days)</Label>
          <p className="text-xs text-muted-foreground">
            Leave blank for no expiry. Defaults to 30 days.
          </p>
          <Input
            id="invite-expiry"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            placeholder="30"
          />
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
