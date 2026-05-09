'use client'

/**
 * Settings → Forum Invites client panel.
 *   - List view → Table of invites with status (available / redeemed / expired)
 *   - Issue modal → label-only form → POST → cleartext code is auto-copied
 *     as a shareable /forum?invite=<code> link to the clipboard, with a
 *     bottom-right toast confirming both. The cleartext never lands in the
 *     DOM — sonner is the single ephemeral disclosure surface.
 */

import { Copy, Mail } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'

// Default body shown in the email-template textarea on the share pane.
// `[link]` is the literal placeholder the admin can move around; we
// replace it with the actual invite URL when "Email" is clicked.
const DEFAULT_EMAIL_BODY = `Hey,

You've been invited to join the LucidIndex forum. Use this link to sign up — it's single-use, so don't share it:

[link]

See you there.`

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
  // Revocation wins over redemption — revoking a redeemed invite is the
  // admin's kill-switch on the linked user's login (the redeemed_at
  // timestamp stays in its own column for audit).
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
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
            <TableHead>Redeemed</TableHead>
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
      <TableCell className="text-xs text-muted-foreground">
        {row.redeemedAt
          ? new Date(row.redeemedAt).toISOString().replace('T', ' ').slice(0, 16)
          : '—'}
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
            onRevoked={onRevoked}
          />
        )}
        {status === 'revoked' && (
          <RestoreButton
            id={row.id}
            label={row.label}
            wasRedeemed={!!row.redeemedAt}
            onRestored={onRevoked}
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
              ? "The forum user who signed up with this invite will be signed out and won't be able to log in again. Their account, posts, and replies are preserved for audit. This can't be undone — to re-grant access, issue a fresh invite and have them sign up again."
              : "The link will stop working immediately. Anyone who already received it won't be able to sign up. The invite record is kept for audit purposes."}
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
  // No confirm dialog — restore is reversible (admin can re-revoke in one
  // click), so the AlertDialog ceremony of the Revoke path would be more
  // friction than it's worth.
  const [pending, setPending] = useState(false)

  async function handleRestore() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/forum-invites/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unrevoke' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Restore failed.')
        return
      }
      toast.success(wasRedeemed ? `Access restored for "${label}".` : `Invite "${label}" restored.`)
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

// ---------------------------------------------------------------------------
// Issue modal content
// ---------------------------------------------------------------------------

type IssueMode = 'form' | 'share'

function IssueModalContent({ onIssued, onClose }: { onIssued: () => void; onClose: () => void }) {
  // Two-pane slide: form (label input) → share (copy / email buttons).
  // Save advances mode to 'share'; the parent's onIssued (which closes the
  // dialog and refreshes the list) only fires when the admin clicks Done
  // on the share pane.
  const [mode, setMode] = useState<IssueMode>('form')
  const [issuedLabel, setIssuedLabel] = useState('')
  const [issuedLink, setIssuedLink] = useState('')

  // Animate the wrapper height to match whichever pane is active. Without
  // this, the flex-row track stretches to the taller (share) pane and the
  // dialog reads as half-empty in form mode. ResizeObserver (instead of a
  // one-shot useEffect on `mode`) keeps the height bound to the *live*
  // box — fonts settling, textarea reflow, etc. won't leave us with a
  // stale measurement and a strip of empty space below the buttons.
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
            onIssued={(label, link) => {
              setIssuedLabel(label)
              setIssuedLink(link)
              setMode('share')
            }}
            onClose={onClose}
          />
        </div>
        <div ref={sharePaneRef} className="w-full shrink-0" aria-hidden={mode !== 'share'}>
          <SharePane label={issuedLabel} link={issuedLink} onDone={onIssued} />
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
  onIssued: (label: string, link: string) => void
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
      const link = `${window.location.origin}/forum?invite=${encodeURIComponent(data.code)}`
      onIssued(trimmed, link)
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
        <DialogDescription>Label the invite — you'll get a shareable link next.</DialogDescription>
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
          placeholder="for Alice"
          className="focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />

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

function SharePane({ label, link, onDone }: { label: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Link copied to clipboard')
      // Reset the visual after a moment so the button is reusable.
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the link and copy manually.')
    }
  }

  // Replace the [link] placeholder in the editable body with the actual
  // invite URL right when the admin clicks Email. The mailto: payload is
  // URL-encoded so newlines + special chars survive the handoff to the OS
  // mail client.
  const renderedBody = emailBody.replace(/\[link\]/g, link)
  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    "You're invited to the LucidIndex forum",
  )}&body=${encodeURIComponent(renderedBody)}`

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share invite</DialogTitle>
        <DialogDescription>
          Send <span className="font-semibold text-foreground">{label}</span> the link below. It's
          single-use — once redeemed, it can't be reused.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 mt-4">
        <code
          className="font-mono text-xs break-all bg-muted border border-border px-3 py-2 rounded select-all"
          data-testid="share-pane-link"
        >
          {link}
        </code>

        <div className="flex flex-col gap-1.5">
          <Textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            rows={8}
            className="font-mono text-xs resize-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
            aria-label="Email body template"
          />
          <p className="text-[11px] text-muted-foreground">
            <code className="font-mono">[link]</code> will be replaced with the actual invite URL
            when the email opens.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="flex-1"
            aria-label="Copy invite link"
          >
            <Copy className="h-4 w-4 mr-2" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" variant="outline" asChild className="flex-1">
            <a href={mailtoHref} aria-label="Email invite link">
              <Mail className="h-4 w-4 mr-2" />
              Email
            </a>
          </Button>
          <Button type="button" onClick={onDone} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    </>
  )
}
