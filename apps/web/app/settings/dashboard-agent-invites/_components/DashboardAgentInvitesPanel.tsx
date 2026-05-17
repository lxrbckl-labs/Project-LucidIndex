'use client'

/**
 * Settings → Dashboard → Agents client panel.
 *
 *   - List view → Table of invites with status (available / redeemed /
 *     expired / revoked).
 *   - Issue modal → label-only form. On submit, POST mints a fresh
 *     invite and returns the cleartext code EXACTLY once. The dialog
 *     slides to a "share" pane showing the code with a copy button.
 *     When the dialog closes, the cleartext is dropped from component
 *     state — the only persistent record is the argon2 hash on the
 *     server.
 *   - Row actions → Revoke / Unrevoke (Restore) on active rows; hard
 *     Delete on terminal (inactive) rows. Both gated by AlertDialog
 *     confirms.
 *   - Clear button → bulk-delete every inactive row.
 *
 * Mirrors `ForumInvitesPanel` (the reference) minus the "email this
 * invite" share pane — agents don't get emails, they get a code their
 * operator pastes into a CLI/config.
 */

import { Copy, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  redeemedTokenId: string | null
  revokedAt: string | null
}

type Props = { initialInvites: InviteRowClient[] }

type Status = 'available' | 'redeemed' | 'expired' | 'revoked'

function deriveStatus(row: InviteRowClient): Status {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'available'
}

export function DashboardAgentInvitesPanel({ initialInvites }: Props) {
  const router = useRouter()
  const [issueOpen, setIssueOpen] = useState(false)

  function handleIssued() {
    setIssueOpen(false)
    router.refresh()
  }

  const inactiveCount = initialInvites.filter((r) => deriveStatus(r) !== 'available').length
  const redeemedCount = initialInvites.filter((r) => deriveStatus(r) === 'redeemed').length

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-end gap-2">
        <ClearButton
          inactiveCount={inactiveCount}
          redeemedCount={redeemedCount}
          onCleared={() => router.refresh()}
        />
        <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
          <DialogTrigger asChild>
            <Button size="sm">New Invite</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <IssueModalContent onIssued={handleIssued} onClose={() => setIssueOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {initialInvites.length === 0 ? (
        <EmptyState onIssue={() => setIssueOpen(true)} />
      ) : (
        <InvitesTable rows={initialInvites} onChanged={() => router.refresh()} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onIssue }: { onIssue: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">No invites yet</h2>
      <p className="max-w-[460px] text-sm text-muted-foreground">
        Mint one to authorize the next external agent against the Dashboard MCP server. Codes are
        shown in plaintext exactly once.
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

function InvitesTable({ rows, onChanged }: { rows: InviteRowClient[]; onChanged: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Issued invites</h2>
        <p className="text-sm text-muted-foreground">
          Available codes can still be redeemed. Revoked / redeemed / expired codes are kept for
          audit.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12" aria-label="Delete" />
            <TableHead>Label</TableHead>
            <TableHead>Hash prefix</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Redeemed</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <InviteRow key={row.id} row={row} onChanged={onChanged} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function InviteRow({ row, onChanged }: { row: InviteRowClient; onChanged: () => void }) {
  const status = deriveStatus(row)

  return (
    <TableRow>
      <TableCell className="w-12 pr-0">
        <DeleteButton
          id={row.id}
          label={row.label}
          status={status}
          wasRedeemed={!!row.redeemedAt}
          onDeleted={onChanged}
        />
      </TableCell>
      <TableCell className="font-semibold">{row.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.codeHash.slice(0, 20)}…
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.redeemedAt
          ? new Date(row.redeemedAt).toISOString().replace('T', ' ').slice(0, 16)
          : '—'}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.redeemedTokenId ? `${row.redeemedTokenId.slice(0, 8)}…` : '—'}
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {(status === 'available' || status === 'redeemed') && (
          <RevokeButton
            id={row.id}
            label={row.label}
            isRedeemed={status === 'redeemed'}
            onRevoked={onChanged}
          />
        )}
        {status === 'revoked' && (
          <RestoreButton
            id={row.id}
            label={row.label}
            wasRedeemed={!!row.redeemedAt}
            onRestored={onChanged}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'available') {
    return (
      <Badge variant="secondary" className="text-emerald-600">
        Available
      </Badge>
    )
  }
  if (status === 'redeemed') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Redeemed
      </Badge>
    )
  }
  if (status === 'revoked') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Revoked
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Expired
    </Badge>
  )
}

function RevokeButton({
  id,
  label,
  isRedeemed,
  onRevoked,
}: {
  id: string
  label: string
  isRedeemed: boolean
  onRevoked: () => void
}) {
  const [pending, setPending] = useState(false)

  async function handleRevoke() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/dashboard-agent-invites/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Revoke failed.')
        return
      }
      toast.success(isRedeemed ? `Access revoked for "${label}".` : `Invite "${label}" revoked.`)
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
          <AlertDialogTitle>
            {isRedeemed ? `Revoke access for “${label}”?` : `Revoke invite “${label}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRedeemed
              ? "The agent's bearer token record stays in place for audit, but the invite is flagged revoked. To actually disable the agent's token, revoke it from the Agent Tokens panel — this revoke is the invite-side audit marker."
              : "The code stops working immediately. Anyone who already received it won't be able to redeem it. The invite record is kept for audit purposes."}
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

function RestoreButton({
  id,
  label,
  wasRedeemed,
  onRestored,
}: {
  id: string
  label: string
  wasRedeemed: boolean
  onRestored: () => void
}) {
  const [pending, setPending] = useState(false)

  async function handleRestore() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/dashboard-agent-invites/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unrevoke' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Restore failed.')
        return
      }
      toast.success(
        wasRedeemed ? `Audit flag cleared for "${label}".` : `Invite "${label}" restored.`,
      )
      onRestored()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleRestore}>
      {pending ? '…' : 'Restore'}
    </Button>
  )
}

function DeleteButton({
  id,
  label,
  status,
  wasRedeemed,
  onDeleted,
}: {
  id: string
  label: string
  status: Status
  wasRedeemed: boolean
  onDeleted: () => void
}) {
  const [pending, setPending] = useState(false)
  const disabled = status === 'available'

  async function handleDelete() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/dashboard-agent-invites/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Delete failed.')
        return
      }
      toast.success(`Invite "${label}" deleted.`)
      onDeleted()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  if (disabled) {
    return (
      <Button
        variant="destructive"
        size="icon"
        className="h-9 w-9"
        disabled
        aria-label="Delete (available invites must be revoked first)"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="icon"
          className="h-9 w-9"
          disabled={pending}
          aria-label={`Delete invite "${label}"`}
        >
          {pending ? <span className="text-xs">…</span> : <Trash2 className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete invite &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {wasRedeemed
              ? "This permanently removes the invite record. The linked agent token row is preserved (deleting the invite sets the FK to NULL, not cascade-delete). This action can't be undone."
              : "This permanently removes the invite record. The action can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ClearButton({
  inactiveCount,
  redeemedCount,
  onCleared,
}: {
  inactiveCount: number
  redeemedCount: number
  onCleared: () => void
}) {
  const [pending, setPending] = useState(false)

  async function handleClear() {
    setPending(true)
    try {
      const res = await fetch('/api/settings/dashboard-agent-invites/clean', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        deleted?: number
        error?: string
      }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Clear failed.')
        return
      }
      toast.success(
        data.deleted === 1 ? '1 invite cleared.' : `${data.deleted ?? 0} invites cleared.`,
      )
      onCleared()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  if (inactiveCount === 0) {
    return (
      <Button variant="outline" size="sm" disabled aria-label="No inactive invites to clear">
        Clear
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? '…' : 'Clear'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {inactiveCount} inactive {inactiveCount === 1 ? 'invite' : 'invites'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {redeemedCount > 0 ? (
              <>
                This sweeps every redeemed, revoked, and expired row from the table.{' '}
                <span className="font-semibold text-foreground">
                  {redeemedCount} of those {redeemedCount === 1 ? 'is' : 'are'} redeemed
                </span>{' '}
                — the linked agent token rows are preserved (FK is set to NULL on invite delete).
                Available invites are untouched. This action can't be undone.
              </>
            ) : (
              "This sweeps every revoked and expired row from the table. Available invites are untouched. This action can't be undone."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleClear}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete all inactive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Issue modal content
// ---------------------------------------------------------------------------

type IssueMode = 'form' | 'share'

function IssueModalContent({ onIssued, onClose }: { onIssued: () => void; onClose: () => void }) {
  // Two-pane slide: form (label input) → share (cleartext code + copy).
  // Cleartext only lives on this component's state — when the dialog
  // closes (either via Done or via the X / overlay click), this whole
  // tree unmounts and the cleartext is dropped.
  const [mode, setMode] = useState<IssueMode>('form')
  const [issuedLabel, setIssuedLabel] = useState('')
  const [issuedCode, setIssuedCode] = useState('')

  const formPaneRef = useRef<HTMLDivElement>(null)
  const sharePaneRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = mode === 'form' ? formPaneRef.current : sharePaneRef.current
    if (!node) return
    const update = () => {
      setTrackHeight(node.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-out"
      style={trackHeight !== undefined ? { height: trackHeight } : undefined}
    >
      <div
        className="flex items-start transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${mode === 'form' ? 0 : 100}%)` }}
      >
        <div ref={formPaneRef} className="w-full shrink-0" aria-hidden={mode !== 'form'}>
          <FormPane
            isActive={mode === 'form'}
            onIssued={(label, code) => {
              setIssuedLabel(label)
              setIssuedCode(code)
              setMode('share')
            }}
            onClose={onClose}
          />
        </div>
        <div ref={sharePaneRef} className="w-full shrink-0" aria-hidden={mode !== 'share'}>
          <SharePane label={issuedLabel} code={issuedCode} onDone={onIssued} />
        </div>
      </div>
    </div>
  )
}

function FormPane({
  isActive,
  onIssued,
  onClose,
}: {
  isActive: boolean
  onIssued: (label: string, code: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

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
      const res = await fetch('/api/settings/dashboard-agent-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      })
      const data = (await res.json()) as { ok: true; code: string } | { ok: false; error?: string }
      if (!res.ok || !data.ok) {
        setError(
          data.ok === false ? (data.error ?? 'Failed to issue invite.') : 'Failed to issue invite.',
        )
        return
      }
      onIssued(trimmed, data.code)
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
          Label the invite — you'll see the cleartext code next, exactly once.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 mt-4">
        <Input
          ref={inputRef}
          id="invite-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          required
          placeholder="for Alice's agent"
          className="focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Issue'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function SharePane({ label, code, onDone }: { label: string; code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Code copied to clipboard', {
        description:
          'Paste it into the agent operator’s redemption call. This is the only time you’ll see the cleartext.',
        duration: 8000,
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the code and copy manually.')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save this code now</DialogTitle>
        <DialogDescription>
          Send <span className="font-semibold text-foreground">{label}</span> the code below. It's
          single-use — once redeemed for a bearer token, it can't be reused, and{' '}
          <span className="font-semibold text-foreground">we can't retrieve it again</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 mt-4">
        <code
          className="font-mono text-xs break-all bg-muted border border-border px-3 py-2 rounded select-all"
          data-testid="share-pane-code"
        >
          {code}
        </code>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="flex-1"
            aria-label="Copy invite code"
          >
            <Copy className="h-4 w-4 mr-2" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" onClick={onDone} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    </>
  )
}
