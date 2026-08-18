'use client'

/**
 * "Clear" button — bulk-deletes every inactive invite row.
 *
 * Self-contained island: owns its own router and refreshes on success.
 * Disabled when there are no inactive rows to sweep.
 */

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
import { Button } from '@/components/ui/button'

export function ClearInvitesButton({
  inactiveCount,
  redeemedCount,
}: {
  inactiveCount: number
  redeemedCount: number
}) {
  const router = useRouter()
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
      router.refresh()
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
