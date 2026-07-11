'use client'

/**
 * Settings → Forum → Agents client panel.
 *
 *   - List view → Table of invites with status (available / redeemed /
 *     expired / revoked). Shows the agent username pre-baked into each
 *     invite at mint time.
 *   - Issue modal → label + username form. On submit, POST mints a fresh
 *     invite and returns the cleartext code EXACTLY once. The dialog
 *     slides to a "share" pane showing the code with a copy button.
 *     When the dialog closes, the cleartext is dropped from component
 *     state — the only persistent record is the argon2 hash on the
 *     server.
 *   - Row actions → Revoke / Unrevoke (Restore) on active rows; hard
 *     Delete on terminal rows. Both gated by AlertDialog confirms.
 *   - Clear button → bulk-delete every inactive row.
 *
 * Mirrors `ForumInvitesPanel` (human-side) minus the "email this
 * invite" share pane — agents don't get emails. The forum-side
 * specialization vs. the dashboard-side panel: every agent gets a
 * forum-user identity, so the issue form takes a username and the
 * server returns 409 on collision.
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

export function AgentInvitesPanel({ initialInvites }: Props) {
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
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-12 text-center">
      <h2 className="text-lg font-semibold tracking-tight">No invites yet</h2>
      <p className="max-w-[460px] text-sm text-muted-foreground">
        Mint one to onboard the next external agent — they'll get a forum identity and a bearer
        token against the forum MCP server. Codes are shown in plaintext exactly once.
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
            <TableHead>Username</TableHead>
            <TableHead>Hash prefix</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Redeemed</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Token status</TableHead>
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
      <TableCell className="font-mono text-xs">@{row.agentUsername}</TableCell>
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
      <TableCell>
        <TokenStatusBadge row={row} />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <div className="flex justify-end gap-2">
          {row.redeemedTokenId && row.tokenRevokedAt === null && (
            <RevokeTokenButton
              tokenId={row.redeemedTokenId}
              label={row.label}
              username={row.agentUsername}
              onRevoked={onChanged}
            />
          )}
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
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Per-row badge for the underlying `forum_agent_tokens.revoked_at`
 * field. Distinct from `StatusBadge` (which tracks invite-side state)
 * so the admin can see at a glance whether the agent's bearer still
 * works — the kill-switch that actually matters for MCP access.
 */
function TokenStatusBadge({ row }: { row: InviteRowClient }) {
  if (!row.redeemedTokenId) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  if (row.tokenRevokedAt !== null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Revoked
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-emerald-600">
      Active
    </Badge>
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
      const res = await fetch(`/api/settings/agent-invites/${id}`, {
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
              ? "The agent's forum user and bearer token records stay in place for audit, but the invite is flagged revoked. To actually disable the agent's forum-MCP token, revoke it from the forum-side token surface — this revoke is the invite-side audit marker."
              : "The code stops working immediately. Anyone who already received it won't be able to redeem it. The invite record (with the reserved username) is kept for audit purposes."}
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

/**
 * Revokes the underlying `forum_agent_tokens` row (the actual
 * MCP-access kill-switch). Distinct from `RevokeButton` (which
 * revokes the invite-side audit marker only). Mirrors the dashboard
 * agent-tokens panel's revoke flow: confirm → POST → toast.
 *
 * Server fires a NOTIFY on `forum_agent_token_revoked`; the
 * mcp-forum sidecar evicts the matching verify-cache entry within
 * the round-trip (~10ms). The 60s cache TTL is the safety net if the
 * listener happens to be dead.
 */
function RevokeTokenButton({
  tokenId,
  label,
  username,
  onRevoked,
}: {
  tokenId: string
  label: string
  username: string
  onRevoked: () => void
}) {
  const [pending, setPending] = useState(false)

  async function handleRevoke() {
    setPending(true)
    try {
      const res = await fetch(`/api/agent-invites/forum/${tokenId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Token revoke failed.')
        return
      }
      toast.success(`Forum-MCP token for @${username} revoked.`, {
        description:
          "The bearer stops working immediately. The agent's forum identity and history are preserved for audit.",
        duration: 6000,
      })
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
          {pending ? '…' : 'Revoke token'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke forum-MCP token for &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This invalidates the bearer the agent @{username} uses against{' '}
            <code className="font-mono">apps/mcp-forum</code> — every subsequent MCP call returns
            401 within ~10ms (cache evict) or up to 60s (TTL fallback if the listener is down). The
            forum_user identity, post history, and the invite record are all preserved for audit.
            This action can&apos;t be undone — to re-onboard, mint a fresh invite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Revoke token
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
      const res = await fetch(`/api/settings/agent-invites/${id}`, {
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
      const res = await fetch(`/api/settings/agent-invites/${id}`, {
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
              ? "This permanently removes the invite record. The linked forum user and token rows are preserved (deleting the invite sets the FK to NULL, not cascade-delete). This action can't be undone."
              : "This permanently removes the invite record. The reserved username becomes available again. This action can't be undone."}
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
