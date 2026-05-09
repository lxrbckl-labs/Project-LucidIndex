'use client'

/**
 * Settings → Forum Invites client panel.
 *   - List view → Table of invites with status (available / redeemed / expired)
 *   - Issue modal → label-only form → POST → cleartext code is auto-copied
 *     as a shareable /forum?invite=<code> link to the clipboard, with a
 *     bottom-right toast confirming both. The cleartext never lands in the
 *     DOM — sonner is the single ephemeral disclosure surface.
 */

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
  redeemedByUserId: string | null
  revokedAt: string | null
}

type Props = { initialInvites: InviteRowClient[] }

type Status = 'available' | 'redeemed' | 'expired' | 'revoked'

function deriveStatus(row: InviteRowClient): Status {
  if (row.redeemedAt) return 'redeemed'
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'available'
}

export function ForumInvitesPanel({ initialInvites }: Props) {
  const router = useRouter()
  const [issueOpen, setIssueOpen] = useState(false)

  // After a successful issue: just close the dialog and refresh the list.
  // Clipboard + toast are handled INSIDE the form's submit handler so
  // they run while the form is still mounted and the click's user
  // activation hasn't expired.
  function handleIssued() {
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

      {initialInvites.length === 0 ? (
        <EmptyState onIssue={() => setIssueOpen(true)} />
      ) : (
        <InvitesTable rows={initialInvites} onRevoked={() => router.refresh()} />
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

function InvitesTable({ rows, onRevoked }: { rows: InviteRowClient[]; onRevoked: () => void }) {
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
            <TableHead>Label</TableHead>
            <TableHead>Hash prefix</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <InviteRow key={row.id} row={row} onRevoked={onRevoked} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function InviteRow({ row, onRevoked }: { row: InviteRowClient; onRevoked: () => void }) {
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
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {status === 'available' && (
          <RevokeButton id={row.id} label={row.label} onRevoked={onRevoked} />
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
      const res = await fetch(`/api/settings/forum-invites/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Revoke failed.')
        return
      }
      toast.success(`Invite "${label}" revoked.`)
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
          <AlertDialogTitle>Revoke invite &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            The link will stop working immediately. Anyone who already received it won't be able to
            sign up. The invite record is kept for audit purposes.
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
// Issue modal content
// ---------------------------------------------------------------------------

function IssueModalContent({ onIssued, onClose }: { onIssued: () => void; onClose: () => void }) {
  const [label, setLabel] = useState('')
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

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/forum-invites', {
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

      // Build the shareable link, copy it to clipboard, and toast — all
      // BEFORE closing the dialog, while the form is still mounted and the
      // click's user activation hasn't expired.
      const link = `${window.location.origin}/forum?invite=${encodeURIComponent(data.code)}`
      let copied = false
      try {
        await navigator.clipboard.writeText(link)
        copied = true
      } catch {
        // Clipboard unavailable — fall through to inline toast.
      }
      toast.success('Invite generated', {
        description: copied
          ? 'Link copied to clipboard. Send it to the person you want to invite.'
          : link,
        duration: copied ? 8000 : 12000,
      })

      onIssued()
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
          The shareable invite link will be copied to your clipboard automatically.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
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
