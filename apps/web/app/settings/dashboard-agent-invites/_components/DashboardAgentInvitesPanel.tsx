'use client'

/**
 * Settings → Dashboard → Agents client panel.
 *
 *   - List view → Table of invites with status (available / redeemed /
 *     expired / revoked).
 *   - Row actions → Revoke / Unrevoke (Restore) on active rows; hard
 *     Delete on terminal (inactive) rows. Both gated by AlertDialog
 *     confirms.
 *
 * The header-level actions (Clear, New Invite) live in the server-rendered
 * sub-header as self-contained islands (`ClearInvitesButton`,
 * `NewInviteDialog`) — this panel only owns the table and empty state.
 *
 * Mirrors `ForumInvitesPanel` (the reference) minus the "email this
 * invite" share pane — agents don't get emails, they get a code their
 * operator pastes into a CLI/config.
 */

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deriveStatus, type InviteRowClient, type Status } from '../_lib/invite-status'
import { NewInviteDialog } from './NewInviteDialog'

type Props = { initialInvites: InviteRowClient[] }

export function DashboardAgentInvitesPanel({ initialInvites }: Props) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-8">
      {initialInvites.length === 0 ? (
        <EmptyState />
      ) : (
        <InvitesTable rows={initialInvites} onChanged={() => router.refresh()} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">No invites yet</h2>
      <p className="max-w-[460px] text-sm text-muted-foreground">
        Mint one to authorize the next external agent against the Dashboard MCP server. Codes are
        shown in plaintext exactly once.
      </p>
      <NewInviteDialog />
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
            {isRedeemed ? `Revoke access for "${label}"?` : `Revoke invite "${label}"?`}
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
